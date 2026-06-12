# { "Depends": "py-genlayer:1j12s63yfjpva9ik2xgnffgrs6v44y1f52jvj9w7xvdn7qckd379" }
from genlayer import *
from dataclasses import dataclass
from typing import Optional
import datetime
import json as _json

MARKET_TYPE_BINARY  = u8(0)
MARKET_TYPE_NUMERIC = u8(1)

STATE_OPEN      = u8(0)
STATE_RESOLVED  = u8(1)
STATE_REJECTED  = u8(2)
STATE_CANCELLED = u8(3)

MAX_PLAYERS = 100
MIN_HOURS   = 0    # no minimum for testing; enforce in UI layer
MAX_HOURS   = 168  # 7 days

ERROR_EXPECTED = "[EXPECTED]"   # business-logic errors — deterministic across validators
ERROR_EXTERNAL = "[EXTERNAL]"   # network/AI failures — non-deterministic, may retry


# ── JSON helpers ──────────────────────────────────────────────────────────────

def _addrs_to_json(addrs: list) -> str:
    return _json.dumps([str(a) for a in addrs])


def _json_to_addrs(s: str) -> list:
    if not s or s == "[]":
        return []
    return [Address(a) for a in _json.loads(s)]


def _to_json(values: list) -> str:
    return _json.dumps(list(values))


def _from_json(s: str) -> list:
    if not s or s == "[]":
        return []
    return _json.loads(s)


@allow_storage
@dataclass
class Market:
    id: u64
    creator: Address
    question: str                # max 300 chars
    market_type: u8              # MARKET_TYPE_BINARY or MARKET_TYPE_NUMERIC
    resolution_datetime: u64     # unix timestamp
    created_at: u64
    state: u8
    rejection_reason: str
    players_json: str            # JSON [hex_addr, ...]
    predictions_json: str        # JSON [bool/float, ...] parallel to players
    submission_times_json: str   # JSON [int, ...] parallel to players
    actual_answer: str           # "true"/"false" for binary; "12345.67" for numeric
    actual_answer_source: str
    ranking_json: str            # JSON [hex_addr, ...] ranking[0] = winner
    resolution_reasoning: str


class Predictions(gl.Contract):
    markets: TreeMap[str, Market]
    next_market_id: u64
    open_ids_json: str     # JSON [int, ...] — IDs of OPEN markets
    resolved_ids_json: str # JSON [int, ...] — IDs of RESOLVED markets
    user_registry_address: Address

    def __init__(self, user_registry_address: Address) -> None:
        self.next_market_id = u64(0)
        self.open_ids_json = "[]"
        self.resolved_ids_json = "[]"
        if not isinstance(user_registry_address, Address):
            user_registry_address = Address(user_registry_address)
        self.user_registry_address = user_registry_address

    # ── private helpers ───────────────────────────────────────────────────────

    def _save_market(self, market_id: u64, m: Market) -> None:
        self.markets[str(int(market_id))] = m

    def _add_to_list(self, list_json: str, market_id: u64) -> str:
        ids = _from_json(list_json)
        ids.append(int(market_id))
        return _to_json(ids)

    def _remove_from_list(self, list_json: str, market_id: u64) -> str:
        ids = _from_json(list_json)
        mid = int(market_id)
        ids = [x for x in ids if x != mid]
        return _to_json(ids)

    def _index_of(self, addrs: list, addr: Address) -> int:
        for i, a in enumerate(addrs):
            if a == addr:
                return i
        return -1

    def _compute_binary_ranking(self, players: list, predictions: list,
                                 sub_times: list, actual: bool) -> list:
        correct = [(players[i], sub_times[i]) for i in range(len(players)) if predictions[i] is actual]
        wrong   = [(players[i], sub_times[i]) for i in range(len(players)) if predictions[i] is not actual]
        correct.sort(key=lambda x: x[1])
        wrong.sort(key=lambda x: x[1])
        return [p for p, _ in correct] + [p for p, _ in wrong]

    def _compute_numeric_ranking(self, players: list, predictions: list, actual: float) -> list:
        distances = [(players[i], abs(predictions[i] - actual)) for i in range(len(players))]
        distances.sort(key=lambda x: x[1])
        return [p for p, _ in distances]

    # ── write methods ─────────────────────────────────────────────────────────

    @gl.public.write
    def create_market(self, question: str, market_type: u8, resolution_datetime: u64) -> u64:
        if len(question) > 300:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Question exceeds 300 characters")
        if int(market_type) not in (0, 1):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid market_type: must be 0 (binary) or 1 (numeric)")

        now = int(datetime.datetime.now().timestamp())
        res_ts = int(resolution_datetime)
        min_ts = now + MIN_HOURS * 3600
        max_ts = now + MAX_HOURS * 3600
        if res_ts < min_ts:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Resolution datetime must be at least 24 hours from now")
        if res_ts > max_ts:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Resolution datetime must be at most 7 days from now")

        market_id = self.next_market_id
        res_dt = datetime.datetime.fromtimestamp(res_ts, tz=datetime.timezone.utc)
        market_type_label = "binary (YES/NO)" if int(market_type) == 0 else "numeric (specific value)"

        verify_prompt = f"""You are verifying whether a prediction question can be answered later via public web sources.

Question: {question}
Resolution date: {res_dt.strftime("%Y-%m-%d %H:%M UTC")}
Market type: {market_type_label}

Criteria:
- The question must have an objective answer by the resolution date
- The answer must be publicly verifiable via standard web sources
- For numeric markets, the answer must be a specific number with clear units
- For binary markets, the answer must be a clear yes/no determination
- Reject questions that depend on subjective judgment, private information, or unverifiable claims
- When in doubt, accept

Respond as JSON in exactly this format:
{{
    "verifiable": true or false,
    "reasoning": "1-2 sentences explaining your decision"
}}"""

        def verify_leader_fn():
            return gl.nondet.exec_prompt(verify_prompt, response_format='json')

        def verify_validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            validator_data = verify_leader_fn()
            leader_data = leader_result.calldata
            return leader_data["verifiable"] == validator_data["verifiable"]

        verify_result = gl.vm.run_nondet_unsafe(verify_leader_fn, verify_validator_fn)

        accepted = bool(verify_result["verifiable"])
        state = STATE_OPEN if accepted else STATE_REJECTED
        rejection_reason = "" if accepted else str(verify_result.get("reasoning", "Rejected by AI verifier"))

        self._save_market(market_id, Market(
            id=market_id,
            creator=gl.message.sender_address,
            question=question,
            market_type=market_type,
            resolution_datetime=resolution_datetime,
            created_at=u64(now),
            state=state,
            rejection_reason=rejection_reason,
            players_json="[]",
            predictions_json="[]",
            submission_times_json="[]",
            actual_answer="",
            actual_answer_source="",
            ranking_json="[]",
            resolution_reasoning="",
        ))
        self.next_market_id = u64(int(market_id) + 1)

        if accepted:
            self.open_ids_json = self._add_to_list(self.open_ids_json, market_id)

        return market_id

    @gl.public.write
    def join_and_predict_binary(self, market_id: u64, prediction: bool) -> None:
        if str(int(market_id)) not in self.markets:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Market not found")
        m = self.markets[str(int(market_id))]

        if int(m.state) != int(STATE_OPEN):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Market is not open")
        if int(m.market_type) != int(MARKET_TYPE_BINARY):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Market is not binary")

        now = int(datetime.datetime.now().timestamp())
        if now >= int(m.resolution_datetime):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Prediction deadline has passed")

        caller = gl.message.sender_address
        players = _json_to_addrs(m.players_json)
        predictions = _from_json(m.predictions_json)
        sub_times = _from_json(m.submission_times_json)

        idx = self._index_of(players, caller)
        if idx >= 0:
            predictions[idx] = prediction
            sub_times[idx] = now
        else:
            if len(players) >= MAX_PLAYERS:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} Market is full")
            players.append(caller)
            predictions.append(prediction)
            sub_times.append(now)

        self._save_market(market_id, Market(
            id=m.id, creator=m.creator, question=m.question, market_type=m.market_type,
            resolution_datetime=m.resolution_datetime, created_at=m.created_at,
            state=m.state, rejection_reason=m.rejection_reason,
            players_json=_addrs_to_json(players),
            predictions_json=_to_json(predictions),
            submission_times_json=_to_json(sub_times),
            actual_answer=m.actual_answer, actual_answer_source=m.actual_answer_source,
            ranking_json=m.ranking_json, resolution_reasoning=m.resolution_reasoning,
        ))

    @gl.public.write
    def join_and_predict_numeric(self, market_id: u64, prediction: str) -> None:
        if str(int(market_id)) not in self.markets:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Market not found")
        m = self.markets[str(int(market_id))]

        if int(m.state) != int(STATE_OPEN):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Market is not open")
        if int(m.market_type) != int(MARKET_TYPE_NUMERIC):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Market is not numeric")

        pred_float = float(prediction)

        now = int(datetime.datetime.now().timestamp())
        if now >= int(m.resolution_datetime):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Prediction deadline has passed")

        caller = gl.message.sender_address
        players = _json_to_addrs(m.players_json)
        predictions = _from_json(m.predictions_json)
        sub_times = _from_json(m.submission_times_json)

        idx = self._index_of(players, caller)
        if idx >= 0:
            predictions[idx] = pred_float
            sub_times[idx] = now
        else:
            if len(players) >= MAX_PLAYERS:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} Market is full")
            players.append(caller)
            predictions.append(pred_float)
            sub_times.append(now)

        self._save_market(market_id, Market(
            id=m.id, creator=m.creator, question=m.question, market_type=m.market_type,
            resolution_datetime=m.resolution_datetime, created_at=m.created_at,
            state=m.state, rejection_reason=m.rejection_reason,
            players_json=_addrs_to_json(players),
            predictions_json=_to_json(predictions),
            submission_times_json=_to_json(sub_times),
            actual_answer=m.actual_answer, actual_answer_source=m.actual_answer_source,
            ranking_json=m.ranking_json, resolution_reasoning=m.resolution_reasoning,
        ))

    @gl.public.write
    def resolve_market(self, market_id: u64) -> None:
        if str(int(market_id)) not in self.markets:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Market not found")
        m = self.markets[str(int(market_id))]

        if int(m.state) != int(STATE_OPEN):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Market is not open or already resolved")

        now = int(datetime.datetime.now().timestamp())
        if now < int(m.resolution_datetime):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Resolution datetime has not arrived yet")

        is_binary = int(m.market_type) == int(MARKET_TYPE_BINARY)
        res_dt = datetime.datetime.fromtimestamp(int(m.resolution_datetime), tz=datetime.timezone.utc)

        players = _json_to_addrs(m.players_json)
        predictions = _from_json(m.predictions_json)
        sub_times = _from_json(m.submission_times_json)
        n = len(players)

        if is_binary:
            binary_prompt = f"""You are resolving a real-world binary prediction market using your web access.

Question: "{m.question}"
Resolution time: {res_dt.strftime("%Y-%m-%d %H:%M UTC")}

Find the answer from public web sources as of the resolution time.
Search reputable sources (news sites, official data providers, verified APIs).

Respond as JSON in exactly this format:
{{
    "answer": true or false,
    "source": "URL or description of the source used",
    "reasoning": "Brief explanation of how you determined the answer"
}}"""

            def binary_leader_fn():
                return gl.nondet.exec_prompt(binary_prompt, response_format='json')

            def binary_validator_fn(leader_result) -> bool:
                if not isinstance(leader_result, gl.vm.Return):
                    return False
                validator_data = binary_leader_fn()
                return leader_result.calldata["answer"] == validator_data["answer"]

            result = gl.vm.run_nondet_unsafe(binary_leader_fn, binary_validator_fn)
            raw_answer = result.get("answer")

        else:
            numeric_prompt = f"""You are resolving a real-world numeric prediction market using your web access.

Question: "{m.question}"
Resolution time: {res_dt.strftime("%Y-%m-%d %H:%M UTC")}

Find the exact numeric answer from public web sources as of the resolution time.
Search reputable sources (financial APIs, official data providers, verified databases).

Respond as JSON in exactly this format:
{{
    "value": <numeric value as a number, no commas or units>,
    "unit": "unit of measurement (e.g. USD, EUR, BTC, count)",
    "source": "URL or description of the source used",
    "reasoning": "Brief explanation of how you determined the value"
}}"""

            def numeric_leader_fn():
                return gl.nondet.exec_prompt(numeric_prompt, response_format='json')

            def numeric_validator_fn(leader_result) -> bool:
                if not isinstance(leader_result, gl.vm.Return):
                    return False
                validator_data = numeric_leader_fn()
                leader_val = float(leader_result.calldata["value"])
                validator_val = float(validator_data["value"])
                if leader_val == 0:
                    return validator_val == 0
                return abs(leader_val - validator_val) / abs(leader_val) <= 0.02

            result = gl.vm.run_nondet_unsafe(numeric_leader_fn, numeric_validator_fn)
            raw_answer = result.get("value")

        source = str(result.get("source", ""))
        reasoning = str(result.get("reasoning", ""))

        if is_binary:
            actual_bool = bool(raw_answer)
            actual_str = "true" if actual_bool else "false"
            ranking_addrs = self._compute_binary_ranking(players, predictions, sub_times, actual_bool)
        else:
            actual_float = float(raw_answer)
            actual_str = str(actual_float)
            ranking_addrs = self._compute_numeric_ranking(players, predictions, actual_float)

        self._save_market(market_id, Market(
            id=m.id, creator=m.creator, question=m.question, market_type=m.market_type,
            resolution_datetime=m.resolution_datetime, created_at=m.created_at,
            state=STATE_RESOLVED, rejection_reason=m.rejection_reason,
            players_json=m.players_json, predictions_json=m.predictions_json,
            submission_times_json=m.submission_times_json,
            actual_answer=actual_str, actual_answer_source=source,
            ranking_json=_addrs_to_json(ranking_addrs),
            resolution_reasoning=reasoning,
        ))

        self.open_ids_json = self._remove_from_list(self.open_ids_json, market_id)
        self.resolved_ids_json = self._add_to_list(self.resolved_ids_json, market_id)

        if n > 0:
            registry = gl.get_contract_at(self.user_registry_address)
            entries = [{"player": str(addr), "rank": rank_i + 1, "total_players": len(ranking_addrs)}
                       for rank_i, addr in enumerate(ranking_addrs)]
            registry.emit().record_match_batch(entries)

    @gl.public.write
    def cancel_market(self, market_id: u64) -> None:
        if str(int(market_id)) not in self.markets:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Market not found")
        m = self.markets[str(int(market_id))]

        if m.creator != gl.message.sender_address:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the creator can cancel this market")
        if int(m.state) != int(STATE_OPEN):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Market is not open")

        players = _json_to_addrs(m.players_json)
        if len(players) > 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Cannot cancel a market that has players")

        self._save_market(market_id, Market(
            id=m.id, creator=m.creator, question=m.question, market_type=m.market_type,
            resolution_datetime=m.resolution_datetime, created_at=m.created_at,
            state=STATE_CANCELLED, rejection_reason=m.rejection_reason,
            players_json=m.players_json, predictions_json=m.predictions_json,
            submission_times_json=m.submission_times_json,
            actual_answer=m.actual_answer, actual_answer_source=m.actual_answer_source,
            ranking_json=m.ranking_json, resolution_reasoning=m.resolution_reasoning,
        ))
        self.open_ids_json = self._remove_from_list(self.open_ids_json, market_id)

    # ── view methods ──────────────────────────────────────────────────────────

    @gl.public.view
    def get_next_market_id(self) -> u64:
        return self.next_market_id

    @gl.public.view
    def get_market(self, market_id: u64) -> Optional[Market]:
        if str(int(market_id)) not in self.markets:
            return None
        return self.markets[str(int(market_id))]

    @gl.public.view
    def get_open_markets(self, limit: u32) -> list[u64]:
        ids = _from_json(self.open_ids_json)
        ids.reverse()
        return [u64(x) for x in ids[:int(limit)]]

    @gl.public.view
    def get_resolved_markets(self, limit: u32) -> list[u64]:
        ids = _from_json(self.resolved_ids_json)
        ids.reverse()
        return [u64(x) for x in ids[:int(limit)]]

    @gl.public.view
    def get_markets_for_player(self, player: Address) -> list[u64]:
        if not isinstance(player, Address):
            player = Address(player)
        result = []
        for i in range(int(self.next_market_id)):
            m = self.markets[str(i)]
            players = _json_to_addrs(m.players_json)
            if self._index_of(players, player) >= 0:
                result.append(u64(i))
        return result
