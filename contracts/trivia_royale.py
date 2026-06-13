# { "Depends": "py-genlayer:1j12s63yfjpva9ik2xgnffgrs6v44y1f52jvj9w7xvdn7qckd379" }
from genlayer import *
from dataclasses import dataclass
from typing import Optional
import datetime
import json as _json

MAX_PLAYERS_CAP = 50
MAX_TOPIC_LEN   = 80
NUM_QUESTIONS   = 8
ROUND_SECONDS   = 120   # 2 minutes per round (generous for async testing)

# Match states
STATE_WAITING    = u8(0)   # lobby, accepting joins
STATE_GENERATING = u8(1)   # host called start, AI generating questions
STATE_IN_PROGRESS = u8(2)  # rounds running
STATE_RESOLVING  = u8(3)   # round resolution (AI checking OE answers)
STATE_ENDED      = u8(4)   # winner declared
STATE_CANCELLED  = u8(5)   # cancelled or AI failed

ZERO_ADDR_STR = "0x" + "0" * 40
DAILY_SENTINEL = "0x0000000000000000000000000000000000da17a1"

ERROR_EXPECTED = "[EXPECTED]"   # business-logic errors --- deterministic across validators
ERROR_EXTERNAL = "[EXTERNAL]"   # network/AI failures --- non-deterministic, may retry


def _addrs_to_json(addrs: list) -> str:
    return _json.dumps([str(a) for a in addrs])


def _json_to_addrs(s: str) -> list:
    if not s or s == "[]":
        return []
    return [Address(a) for a in _json.loads(s)]


def _strs_to_json(strings: list) -> str:
    return _json.dumps(list(strings))


def _json_to_strs(s: str) -> list:
    if not s or s == "[]":
        return []
    return _json.loads(s)


@allow_storage
@dataclass
class TriviaMatch:
    id: u64
    host_str: str           # host address as lowercase hex
    topic: str
    max_players: u32
    players_json: str       # JSON [hex_addr, ...] all joined players
    eliminated_json: str    # JSON [hex_addr, ...] in elimination order
    state: u8
    rejection_reason: str
    questions_json: str     # JSON [{type, text, options, correct_answer, alternates}, ...]
    current_round: u8       # 0-indexed (maps to questions[current_round])
    round_answers_json: str # JSON {"0xlower": "answer"} reset each round
    answer_deadline: u64    # 0 = not set
    winner_str: str         # empty or lowercase hex addr
    created_at: u64
    is_daily_generated: bool


class TriviaRoyale(gl.Contract):
    matches: TreeMap[str, TriviaMatch]
    next_match_id: u64
    open_ids_json: str    # JSON [u64] matches in WAITING state
    active_ids_json: str  # JSON [u64] matches in IN_PROGRESS or GENERATING
    user_registry_address: Address
    last_daily_generation: u64
    daily_match_ids_json: str

    def __init__(self, user_registry_address: Address) -> None:
        self.next_match_id = u64(0)
        self.open_ids_json = "[]"
        self.active_ids_json = "[]"
        self.last_daily_generation = u64(0)
        self.daily_match_ids_json = "[]"
        if not isinstance(user_registry_address, Address):
            user_registry_address = Address(user_registry_address)
        self.user_registry_address = user_registry_address

    # ------ helpers ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

    def _save(self, mid: u64, m: TriviaMatch) -> None:
        self.matches[str(int(mid))] = m

    def _active_players(self, players: list, eliminated: list) -> list:
        elim_set = set(str(e).lower() for e in eliminated)
        return [p for p in players if str(p).lower() not in elim_set]

    def _index_of(self, lst: list, addr: Address) -> int:
        for i, a in enumerate(lst):
            if str(a).lower() == str(addr).lower():
                return i
        return -1

    def _add_id(self, ids_json: str, mid: u64) -> str:
        ids = _json_to_strs(ids_json) if ids_json and ids_json != "[]" else []
        ids.append(int(mid))
        return _strs_to_json(ids)

    def _remove_id(self, ids_json: str, mid: u64) -> str:
        ids = _json_to_strs(ids_json) if ids_json and ids_json != "[]" else []
        ids = [x for x in ids if x != int(mid)]
        return _strs_to_json(ids)

    # ------ write methods ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

    @gl.public.write
    def create_match(self, topic: str, max_players: u32 = u32(10)) -> u64:
        if len(topic) == 0 or len(topic) > MAX_TOPIC_LEN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Topic must be 1-{MAX_TOPIC_LEN} characters")
        if int(max_players) < 2:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} max_players must be at least 2")
        if int(max_players) > MAX_PLAYERS_CAP:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} max_players cannot exceed {MAX_PLAYERS_CAP}")

        caller = gl.message.sender_address
        now = int(datetime.datetime.now().timestamp())

        verify_prompt = f"""Is the following topic suitable for generating {NUM_QUESTIONS}+ trivia questions with publicly verifiable factual answers?

Topic: "{topic}"

Criteria:
- Reject if the topic is too vague, too personal/private, entirely subjective, or has fewer than {NUM_QUESTIONS} publicly known facts
- When in doubt, accept

Respond as JSON in exactly this format:
{{
    "acceptable": true or false,
    "reasoning": "One sentence explaining your decision"
}}"""

        def verify_leader_fn():
            return gl.nondet.exec_prompt(verify_prompt, response_format='json')

        def verify_validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            validator_data = verify_leader_fn()
            return leader_result.calldata["acceptable"] == validator_data["acceptable"]

        verify_result = gl.vm.run_nondet_unsafe(verify_leader_fn, verify_validator_fn)
        accepted = bool(verify_result["acceptable"])

        match_id = self.next_match_id
        self.next_match_id = u64(int(match_id) + 1)

        if accepted:
            self._save(match_id, TriviaMatch(
                id=match_id,
                host_str=str(caller).lower(),
                topic=topic,
                max_players=max_players,
                players_json=_addrs_to_json([caller]),
                eliminated_json="[]",
                state=STATE_WAITING,
                rejection_reason="",
                questions_json="[]",
                current_round=u8(0),
                round_answers_json="{}",
                answer_deadline=u64(0),
                winner_str="",
                created_at=u64(now),
                is_daily_generated=False,
            ))
            self.open_ids_json = self._add_id(self.open_ids_json, match_id)
        else:
            self._save(match_id, TriviaMatch(
                id=match_id,
                host_str=str(caller).lower(),
                topic=topic,
                max_players=max_players,
                players_json=_addrs_to_json([caller]),
                eliminated_json="[]",
                state=STATE_CANCELLED,
                rejection_reason=str(verify_result.get("reasoning", "Topic rejected by AI")),
                questions_json="[]",
                current_round=u8(0),
                round_answers_json="{}",
                answer_deadline=u64(0),
                winner_str="",
                created_at=u64(now),
                is_daily_generated=False,
            ))
        return match_id

    @gl.public.write
    def join_match(self, match_id: u64) -> None:
        caller = gl.message.sender_address
        if str(int(match_id)) not in self.matches:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Match not found")
        m = self.matches[str(int(match_id))]
        if int(m.state) != int(STATE_WAITING):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Match is not open for joining")
        players = _json_to_addrs(m.players_json)
        if len(players) >= int(m.max_players):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Match is full")
        if self._index_of(players, caller) >= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Already joined this match")
        players.append(caller)
        self._save(match_id, TriviaMatch(
            id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
            players_json=_addrs_to_json(players), eliminated_json=m.eliminated_json,
            state=m.state, rejection_reason=m.rejection_reason,
            questions_json=m.questions_json, current_round=m.current_round,
            round_answers_json=m.round_answers_json, answer_deadline=m.answer_deadline,
            winner_str=m.winner_str, is_daily_generated=m.is_daily_generated, created_at=m.created_at,
        ))

    @gl.public.write
    def start_match(self, match_id: u64) -> None:
        caller = gl.message.sender_address
        if str(int(match_id)) not in self.matches:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Match not found")
        m = self.matches[str(int(match_id))]
        if int(m.state) != int(STATE_WAITING):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Match already started or is finished")
        if str(caller).lower() != m.host_str:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the host can start the match")
        players = _json_to_addrs(m.players_json)
        if len(players) < 2:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Need at least 2 players to start")

        now = int(datetime.datetime.now().timestamp())

        gen_prompt = (
            f'Generate exactly {NUM_QUESTIONS} trivia questions about: "{m.topic}"\n\n'
            f'Format rules:\n'
            f'- Questions 1-6: multiple-choice. 4 options labeled "A) ...", "B) ...", "C) ...", "D) ...". '
            f'  One correct answer (give just the letter: A, B, C, or D).\n'
            f'- Questions 7-8: open-ended. Short factual answer (1-4 words). '
            f'  Give the canonical answer and up to 2 acceptable alternate phrasings.\n'
            f'- Start easy (widely known facts), get harder.\n\n'
            f'Respond as JSON in exactly this format:\n'
            f'{{"questions": [\n'
            f'  {{"type": "mc", "text": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], '
            f'"correct_answer": "A", "alternates": []}},\n'
            f'  {{"type": "open", "text": "...", "options": [], '
            f'"correct_answer": "...", "alternates": ["...", "..."]}}\n'
            f']}}'
        )

        def gen_leader_fn():
            return gl.nondet.exec_prompt(gen_prompt, response_format='json')

        def gen_validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            qs = leader_result.calldata.get("questions", [])
            if len(qs) < NUM_QUESTIONS:
                return False
            for q in qs:
                if not q.get("type") or not q.get("text"):
                    return False
            return True

        result = gl.vm.run_nondet_unsafe(gen_leader_fn, gen_validator_fn)

        questions = result.get('questions', [])
        if len(questions) < NUM_QUESTIONS:
            while len(questions) < NUM_QUESTIONS:
                questions.append({
                    "type": "mc",
                    "text": f"Bonus question about {m.topic}: True or false --- this topic is interesting-",
                    "options": ["A) True", "B) False", "C) Maybe", "D) Unknown"],
                    "correct_answer": "A",
                    "alternates": [],
                })

        deadline = now + ROUND_SECONDS
        self._save(match_id, TriviaMatch(
            id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
            players_json=m.players_json, eliminated_json="[]",
            state=STATE_IN_PROGRESS, rejection_reason="",
            questions_json=_json.dumps(questions),
            current_round=u8(0),
            round_answers_json="{}",
            answer_deadline=u64(deadline),
            winner_str="",
            is_daily_generated=m.is_daily_generated,
            created_at=m.created_at,
        ))
        self.open_ids_json = self._remove_id(self.open_ids_json, match_id)
        self.active_ids_json = self._add_id(self.active_ids_json, match_id)

    @gl.public.write
    def submit_answer(self, match_id: u64, answer: str) -> None:
        caller = gl.message.sender_address
        if str(int(match_id)) not in self.matches:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Match not found")
        m = self.matches[str(int(match_id))]
        if int(m.state) != int(STATE_IN_PROGRESS):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Match is not in progress")
        players = _json_to_addrs(m.players_json)
        eliminated = _json_to_addrs(m.eliminated_json)
        active = self._active_players(players, eliminated)
        if self._index_of(active, caller) < 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} You are not an active player in this match")
        now = int(datetime.datetime.now().timestamp())
        if int(m.answer_deadline) > 0 and now > int(m.answer_deadline):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Answer deadline has passed")
        round_answers = _json.loads(m.round_answers_json) if m.round_answers_json else {}
        round_answers[str(caller).lower()] = str(answer)
        self._save(match_id, TriviaMatch(
            id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
            players_json=m.players_json, eliminated_json=m.eliminated_json,
            state=m.state, rejection_reason=m.rejection_reason,
            questions_json=m.questions_json, current_round=m.current_round,
            round_answers_json=_json.dumps(round_answers),
            answer_deadline=m.answer_deadline,
            winner_str=m.winner_str, is_daily_generated=m.is_daily_generated, created_at=m.created_at,
        ))

    @gl.public.write
    def resolve_round(self, match_id: u64) -> None:
        if str(int(match_id)) not in self.matches:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Match not found")
        m = self.matches[str(int(match_id))]
        if int(m.state) != int(STATE_IN_PROGRESS):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Match is not in progress")

        players = _json_to_addrs(m.players_json)
        eliminated = _json_to_addrs(m.eliminated_json)
        active = self._active_players(players, eliminated)

        now = int(datetime.datetime.now().timestamp())
        deadline_passed = int(m.answer_deadline) > 0 and now > int(m.answer_deadline)
        round_answers = _json.loads(m.round_answers_json) if m.round_answers_json else {}
        all_answered = all(str(p).lower() in round_answers for p in active)

        if not deadline_passed and not all_answered:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Waiting for all players to answer or deadline to pass")

        questions = _json.loads(m.questions_json)
        round_idx = int(m.current_round)
        if round_idx >= len(questions):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No more questions")
        q = questions[round_idx]
        q_type = q.get('type', 'mc')
        correct_answer = str(q.get('correct_answer', '')).strip()

        # Determine correctness per active player
        newly_eliminated = []
        if q_type == 'mc':
            for p in active:
                submitted = round_answers.get(str(p).lower(), "").strip().upper()
                if submitted != correct_answer.upper():
                    newly_eliminated.append(p)
        else:
            # Open-ended: batch-verify all answers with AI
            player_answers = []
            for p in active:
                ans = round_answers.get(str(p).lower(), "")
                player_answers.append(ans)

            alternates = q.get('alternates', [])
            answers_block = "\n".join(
                f"Player {i+1}: \"{player_answers[i]}\"" for i in range(len(active))
            )
            oe_count = len(active)
            verify_prompt = (
                f'Trivia question: "{q.get("text", "")}"\n'
                f'Correct answer: "{correct_answer}"\n'
                f'Also acceptable: {alternates}\n\n'
                f'For each numbered player below, determine if their answer is correct.\n'
                f'Be lenient: accept minor typos, common abbreviations, alternate valid phrasings.\n'
                f'Reject: wrong entity, completely different meaning, empty string, or gibberish.\n\n'
                f'{answers_block}\n\n'
                f'Respond as JSON in exactly this format:\n'
                f'{{"results": [true or false per player in order, exactly {oe_count} values],\n'
                f' "explanations": ["why correct/incorrect for each player in order"]}}'
            )

            def oe_leader_fn():
                return gl.nondet.exec_prompt(verify_prompt, response_format='json')

            def oe_validator_fn(leader_result) -> bool:
                if not isinstance(leader_result, gl.vm.Return):
                    return False
                validator_data = oe_leader_fn()
                return leader_result.calldata.get("results") == validator_data.get("results")

            verify_result = gl.vm.run_nondet_unsafe(oe_leader_fn, oe_validator_fn)
            correctness = verify_result.get('results', [False] * len(active))
            for i, p in enumerate(active):
                is_correct = bool(correctness[i]) if i < len(correctness) else False
                if not is_correct:
                    newly_eliminated.append(p)

        # Update eliminated list
        elim_list = list(eliminated) + list(newly_eliminated)
        survivors = self._active_players(players, elim_list)

        new_round = round_idx + 1
        new_deadline = int(datetime.datetime.now().timestamp()) + ROUND_SECONDS

        if len(survivors) == 1:
            winner = survivors[0]
            self._save(match_id, TriviaMatch(
                id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
                players_json=m.players_json,
                eliminated_json=_addrs_to_json(elim_list),
                state=STATE_ENDED, rejection_reason="",
                questions_json=m.questions_json, current_round=u8(new_round % 256),
                round_answers_json="{}",
                answer_deadline=u64(0),
                winner_str=str(winner).lower(), is_daily_generated=m.is_daily_generated, created_at=m.created_at,
            ))
            self.active_ids_json = self._remove_id(self.active_ids_json, match_id)
            registry = gl.get_contract_at(self.user_registry_address)
            winner_str = str(winner).lower()
            entries = [{"player": str(p),
                        "rank": 1 if str(p).lower() == winner_str else 2,
                        "total_players": len(players)}
                       for p in players]
            registry.emit().record_match_batch(entries)
        elif len(survivors) == 0:
            # All wrong --- no one eliminated this round; advance without eliminating
            if new_round >= len(questions):
                last_survivor = players[0] if players else None
                for p in players:
                    if self._index_of(list(eliminated), p) < 0:
                        last_survivor = p
                        break
                self._save(match_id, TriviaMatch(
                    id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
                    players_json=m.players_json,
                    eliminated_json=_addrs_to_json(list(eliminated)),
                    state=STATE_ENDED, rejection_reason="",
                    questions_json=m.questions_json, current_round=u8(new_round % 256),
                    round_answers_json="{}",
                    answer_deadline=u64(0),
                    winner_str=str(last_survivor).lower() if last_survivor else "",
                    is_daily_generated=m.is_daily_generated,
                    created_at=m.created_at,
                ))
                self.active_ids_json = self._remove_id(self.active_ids_json, match_id)
            else:
                # Tiebreaker: no one eliminated, advance to next question
                self._save(match_id, TriviaMatch(
                    id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
                    players_json=m.players_json,
                    eliminated_json=m.eliminated_json,
                    state=STATE_IN_PROGRESS, rejection_reason="",
                    questions_json=m.questions_json, current_round=u8(new_round % 256),
                    round_answers_json="{}",
                    answer_deadline=u64(new_deadline),
                    winner_str="", is_daily_generated=m.is_daily_generated, created_at=m.created_at,
                ))
        else:
            # 2+ survivors --- advance to next round
            if new_round >= len(questions):
                if len(questions) >= 40:
                    winner = survivors[0]
                    survivor_strs = set(str(s).lower() for s in survivors)
                    self._save(match_id, TriviaMatch(
                        id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
                        players_json=m.players_json,
                        eliminated_json=_addrs_to_json(elim_list),
                        state=STATE_ENDED, rejection_reason="",
                        questions_json=m.questions_json, current_round=u8(new_round % 256),
                        round_answers_json="{}",
                        answer_deadline=u64(0),
                        winner_str=str(winner).lower(), is_daily_generated=m.is_daily_generated, created_at=m.created_at,
                    ))
                    self.active_ids_json = self._remove_id(self.active_ids_json, match_id)
                    registry = gl.get_contract_at(self.user_registry_address)
                    entries = [{"player": str(p),
                                "rank": 1 if str(p).lower() in survivor_strs else 2,
                                "total_players": len(players)}
                               for p in players]
                    registry.emit().record_match_batch(entries)
                else:
                    self._generate_more_questions(match_id, m, elim_list, new_round)
            else:
                self._save(match_id, TriviaMatch(
                    id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
                    players_json=m.players_json,
                    eliminated_json=_addrs_to_json(elim_list),
                    state=STATE_IN_PROGRESS, rejection_reason="",
                    questions_json=m.questions_json, current_round=u8(new_round % 256),
                    round_answers_json="{}",
                    answer_deadline=u64(new_deadline),
                    winner_str="", is_daily_generated=m.is_daily_generated, created_at=m.created_at,
                ))

    def _generate_more_questions(self, match_id: u64, m, elim_list: list, new_round: int, batch_size: int = 8) -> None:
        """Generate additional trivia questions when the pool is exhausted mid-match."""
        questions = _json.loads(m.questions_json)
        existing_texts = [q.get('text', '') for q in questions]
        avoid_block = "\n".join(f"- {t}" for t in existing_texts)

        gen_prompt = (
            f'Generate exactly {batch_size} additional trivia questions about: "{m.topic}"\n\n'
            f'These questions have already been asked, do not repeat them:\n{avoid_block}\n\n'
            f'Format rules:\n'
            f'- Mix of multiple-choice and open-ended questions.\n'
            f'- Multiple-choice: 4 options labeled "A) ...", "B) ...", "C) ...", "D) ...". '
            f'  One correct answer (give just the letter: A, B, C, or D).\n'
            f'- Open-ended: Short factual answer (1-4 words). '
            f'  Give the canonical answer and up to 2 acceptable alternate phrasings.\n\n'
            f'Respond as JSON in exactly this format:\n'
            f'{{"questions": [\n'
            f'  {{"type": "mc", "text": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], '
            f'"correct_answer": "A", "alternates": []}}\n'
            f']}}'
        )

        def more_leader_fn():
            return gl.nondet.exec_prompt(gen_prompt, response_format='json')

        def more_validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            qs = leader_result.calldata.get("questions", [])
            if len(qs) < batch_size:
                return False
            for q in qs:
                if not q.get("type") or not q.get("text"):
                    return False
            return True

        result = gl.vm.run_nondet_unsafe(more_leader_fn, more_validator_fn)

        new_qs = result.get('questions', [])
        while len(new_qs) < batch_size:
            new_qs.append({
                "type": "mc",
                "text": f"Bonus question about {m.topic}: Is this topic fascinating?",
                "options": ["A) Yes", "B) No", "C) Maybe", "D) Unknown"],
                "correct_answer": "A",
                "alternates": [],
            })

        all_questions = questions + new_qs
        now = int(datetime.datetime.now().timestamp())
        new_deadline = now + ROUND_SECONDS

        self._save(match_id, TriviaMatch(
            id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
            players_json=m.players_json,
            eliminated_json=_addrs_to_json(elim_list),
            state=STATE_IN_PROGRESS, rejection_reason="",
            questions_json=_json.dumps(all_questions),
            current_round=u8(new_round % 256),
            round_answers_json="{}",
            answer_deadline=u64(new_deadline),
            winner_str="", is_daily_generated=m.is_daily_generated, created_at=m.created_at,
        ))

    @gl.public.write
    def cancel_match(self, match_id: u64) -> None:
        caller = gl.message.sender_address
        if str(int(match_id)) not in self.matches:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Match not found")
        m = self.matches[str(int(match_id))]
        if int(m.state) != int(STATE_WAITING):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Can only cancel a match that is waiting for players")
        if str(caller).lower() != m.host_str:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the host can cancel")
        self._save(match_id, TriviaMatch(
            id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
            players_json=m.players_json, eliminated_json=m.eliminated_json,
            state=STATE_CANCELLED, rejection_reason="Cancelled by host",
            questions_json=m.questions_json, current_round=m.current_round,
            round_answers_json=m.round_answers_json, answer_deadline=m.answer_deadline,
            winner_str=m.winner_str, is_daily_generated=m.is_daily_generated, created_at=m.created_at,
        ))
        self.open_ids_json = self._remove_id(self.open_ids_json, match_id)

    # ------ view methods ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

    @gl.public.view
    def get_match(self, match_id: u64) -> Optional[TriviaMatch]:
        if str(int(match_id)) not in self.matches:
            return None
        return self.matches[str(int(match_id))]

    @gl.public.view
    def get_open_matches(self, limit: u32) -> list[u64]:
        ids = _json_to_strs(self.open_ids_json)
        ids.reverse()
        return [u64(x) for x in ids[:int(limit)]]

    @gl.public.view
    def get_active_matches(self, limit: u32) -> list[u64]:
        ids = _json_to_strs(self.active_ids_json)
        ids.reverse()
        return [u64(x) for x in ids[:int(limit)]]

    @gl.public.view
    def get_matches_for_player(self, player: Address) -> list[u64]:
        if not isinstance(player, Address):
            player = Address(player)
        result = []
        for i in range(int(self.next_match_id)):
            m = self.matches[str(i)]
            players = _json_to_addrs(m.players_json)
            if self._index_of(players, player) >= 0:
                result.append(u64(i))
        return result

    @gl.public.view
    def get_current_question(self, match_id: u64) -> str:
        if str(int(match_id)) not in self.matches:
            return "{}"
        m = self.matches[str(int(match_id))]
        questions = _json.loads(m.questions_json) if m.questions_json and m.questions_json != "[]" else []
        idx = int(m.current_round)
        if idx < len(questions):
            return _json.dumps(questions[idx])
        return "{}"

    @gl.public.write
    def generate_daily_content_if_due(self) -> None:
        now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
        current_day = (now // 86400) * 86400
        last_day = (int(self.last_daily_generation) // 86400) * 86400 if int(self.last_daily_generation) > 0 else 0
        if current_day == last_day:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Daily content already generated today")
        self._generate_daily_ai(now)

    def _generate_daily_ai(self, now: int) -> None:
        generation_prompt = self._build_daily_generation_prompt(now)

        def leader_fn():
            return gl.nondet.exec_prompt(generation_prompt, response_format='json')

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._validate_daily_batch_structure(leader_result.calldata)

        batch = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self._create_daily_matches_from_batch(batch, now)
        self.last_daily_generation = u64(now)

    def _build_daily_generation_prompt(self, now: int) -> str:
        current_date_iso = datetime.datetime.fromtimestamp(now, datetime.timezone.utc).strftime("%Y-%m-%d")
        return (
            f"You are generating 5 trivia topics for daily battle-royale matches. "
            f"Each topic seeds a pool of AI-generated questions that players will compete on.\n\n"
            f"Today is {current_date_iso}.\n\n"
            f"Generate 5 diverse topics:\n"
            f"- Mix of breadth: some narrow (specific movies, books, eras), some broad (general history, sciences)\n"
            f"- Mix of depth: some casual, some require real knowledge\n"
            f"- Mix of vibes: pop culture, classics, sciences, sports, geography, art\n"
            f"- Each topic should be RICH enough that an AI could generate 8+ good questions about it\n"
            f"- Avoid topics tied to current events that may date quickly\n"
            f"- Avoid politically charged topics\n\n"
            f"Constraints per topic:\n"
            f"- topic: 30-80 character description, specific enough to seed good questions\n"
            f"- max_players: integer between 6 and 30\n"
            f"- duration_hours: integer between 6 and 24\n\n"
            f"Respond as JSON in exactly this format:\n"
            f'{{"topics": ['
            f'{{"topic": "Studio Ghibli films and their visual themes", "max_players": 15, "duration_hours": 12}},'
            f'{{"topic": "The history of paper and printing across civilizations", "max_players": 12, "duration_hours": 18}}'
            f']}}\n\n'
            f"Exactly 5 entries in the topics array."
        )

    def _validate_daily_batch_structure(self, data: dict) -> bool:
        topics = data.get("topics", [])
        if len(topics) != 5:
            return False
        for t in topics:
            if not isinstance(t.get("topic"), str) or len(t["topic"]) < 10:
                return False
            mp = t.get("max_players", 0)
            dh = t.get("duration_hours", 0)
            if not (6 <= int(mp) <= 30):
                return False
            if not (6 <= int(dh) <= 24):
                return False
        return True

    def _create_daily_matches_from_batch(self, batch: dict, now: int) -> None:
        topics_data = batch.get("topics", [])
        new_ids = []
        for item in topics_data:
            topic = str(item["topic"])[:MAX_TOPIC_LEN]
            max_players = max(6, min(30, int(item.get("max_players", 15))))
            match_id = self.next_match_id
            self.next_match_id = u64(int(match_id) + 1)
            self._save(match_id, TriviaMatch(
                id=match_id,
                host_str=DAILY_SENTINEL,
                topic=topic,
                max_players=u32(max_players),
                players_json="[]",
                eliminated_json="[]",
                state=STATE_WAITING,
                rejection_reason="",
                questions_json="[]",
                current_round=u8(0),
                round_answers_json="{}",
                answer_deadline=u64(0),
                winner_str="",
                is_daily_generated=True,
                created_at=u64(now),
            ))
            self.open_ids_json = self._add_id(self.open_ids_json, match_id)
            new_ids.append(int(match_id))
        self.daily_match_ids_json = _json.dumps(new_ids)

    @gl.public.view
    def get_daily_match_ids(self) -> list[u64]:
        ids = _json_to_strs(self.daily_match_ids_json) if self.daily_match_ids_json and self.daily_match_ids_json != "[]" else []
        return [u64(x) for x in ids]

    @gl.public.view
    def get_last_daily_generation(self) -> u64:
        return self.last_daily_generation

