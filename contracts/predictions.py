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
    markets: TreeMap[u64, Market]
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
        self.markets[market_id] = m

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
            raise Exception("Question exceeds 300 characters")
        if int(market_type) not in (0, 1):
            raise Exception("Invalid market_type: must be 0 (binary) or 1 (numeric)")

        now = int(datetime.datetime.now().timestamp())
        res_ts = int(resolution_datetime)
        min_ts = now + MIN_HOURS * 3600
        max_ts = now + MAX_HOURS * 3600
        if res_ts < min_ts:
            raise Exception("Resolution datetime must be at least 24 hours from now")
        if res_ts > max_ts:
            raise Exception("Resolution datetime must be at most 7 days from now")

        market_id = self.next_market_id
        res_dt = datetime.datetime.fromtimestamp(res_ts, tz=datetime.timezone.utc)

        verify_prompt = (
            f'Is the following prediction market question answerable from public web sources '
            f'at or after {res_dt.strftime("%Y-%m-%d %H:%M UTC")}?\n\n'
            f'Question: "{question}"\n\n'
            f'Answer YES or NO, then briefly explain. '
            f'Reject only if the question CANNOT be answered from public web sources by the resolution datetime. '
            f'Reject subjective opinions or questions requiring private data. '
            f'When in doubt, accept.\n\n'
            f'Start your response with YES or NO.'
        )

        verify_result = gl.eq_principle.prompt_comparative(
            lambda: gl.nondet.exec_prompt(verify_prompt, response_format='text'),
            'Both outputs start with YES or both outputs start with NO',
        )

        answer_text = str(verify_result).strip().upper()
        accepted = answer_text.startswith("YES")
        state = STATE_OPEN if accepted else STATE_REJECTED
        rejection_reason = "" if accepted else str(verify_result).strip()

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
        if market_id not in self.markets:
            raise Exception("Market not found")
        m = self.markets[market_id]

        if int(m.state) != int(STATE_OPEN):
            raise Exception("Market is not open")
        if int(m.market_type) != int(MARKET_TYPE_BINARY):
            raise Exception("Market is not binary")

        now = int(datetime.datetime.now().timestamp())
        if now >= int(m.resolution_datetime):
            raise Exception("Prediction deadline has passed")

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
                raise Exception("Market is full")
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
        if market_id not in self.markets:
            raise Exception("Market not found")
        m = self.markets[market_id]

        if int(m.state) != int(STATE_OPEN):
            raise Exception("Market is not open")
        if int(m.market_type) != int(MARKET_TYPE_NUMERIC):
            raise Exception("Market is not numeric")

        pred_float = float(prediction)

        now = int(datetime.datetime.now().timestamp())
        if now >= int(m.resolution_datetime):
            raise Exception("Prediction deadline has passed")

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
                raise Exception("Market is full")
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
        if market_id not in self.markets:
            raise Exception("Market not found")
        m = self.markets[market_id]

        if int(m.state) != int(STATE_OPEN):
            raise Exception("Market is not open or already resolved")

        now = int(datetime.datetime.now().timestamp())
        if now < int(m.resolution_datetime):
            raise Exception("Resolution datetime has not arrived yet")

        is_binary  = int(m.market_type) == int(MARKET_TYPE_BINARY)
        res_dt = datetime.datetime.fromtimestamp(int(m.resolution_datetime), tz=datetime.timezone.utc)

        if is_binary:
            answer_fmt = 'Return JSON: {"answer": true or false, "source": "URL or source name", "reasoning": "brief explanation"}'
            criteria_str = 'The "answer" field is identical (both true or both false)'
        else:
            answer_fmt = 'Return JSON: {"answer": <numeric value as a number, no commas or units>, "source": "URL or source name", "reasoning": "brief explanation"}'
            criteria_str = 'Both outputs return a JSON object with a numeric "answer" field that is a positive number'

        resolution_prompt = (
            f'You are resolving a real-world prediction market. Use your web access to find the actual answer.\n\n'
            f'Question: "{m.question}"\n'
            f'Resolution time: {res_dt.strftime("%Y-%m-%d %H:%M UTC")}\n\n'
            f'Find the answer from public web sources as of the resolution time. '
            f'Search reputable sources (news sites, official APIs, financial data providers).\n\n'
            f'{answer_fmt}\n\n'
            f'Return only valid JSON, no markdown.'
        )

        result = gl.eq_principle.prompt_comparative(
            lambda: gl.nondet.exec_prompt(resolution_prompt, response_format='json'),
            criteria_str,
        )

        if isinstance(result, str):
            result = _json.loads(result)

        raw_answer = result.get('answer')
        source = str(result.get('source', ''))
        reasoning = str(result.get('reasoning', ''))

        players = _json_to_addrs(m.players_json)
        predictions = _from_json(m.predictions_json)
        sub_times = _from_json(m.submission_times_json)
        n = len(players)

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
        if market_id not in self.markets:
            raise Exception("Market not found")
        m = self.markets[market_id]

        if m.creator != gl.message.sender_address:
            raise Exception("Only the creator can cancel this market")
        if int(m.state) != int(STATE_OPEN):
            raise Exception("Market is not open")

        players = _json_to_addrs(m.players_json)
        if len(players) > 0:
            raise Exception("Cannot cancel a market that has players")

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
        if market_id not in self.markets:
            return None
        return self.markets[market_id]

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
            m = self.markets[u64(i)]
            players = _json_to_addrs(m.players_json)
            if self._index_of(players, player) >= 0:
                result.append(u64(i))
        return result
