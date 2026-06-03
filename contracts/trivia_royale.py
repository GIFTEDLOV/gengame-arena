# { "Depends": "py-genlayer:1j12s63yfjpva9ik2xgnffgrs6v44y1f52jvj9w7xvdn7qckd379" }
from genlayer import *
from dataclasses import dataclass
from typing import Optional
import datetime
import json as _json

MAX_PLAYERS_CAP = 50
MAX_TOPIC_LEN   = 80
NUM_QUESTIONS   = 15
ROUND_SECONDS   = 120   # 2 minutes per round (generous for async testing)

# Match states
STATE_WAITING    = u8(0)   # lobby, accepting joins
STATE_GENERATING = u8(1)   # host called start, AI generating questions
STATE_IN_PROGRESS = u8(2)  # rounds running
STATE_RESOLVING  = u8(3)   # round resolution (AI checking OE answers)
STATE_ENDED      = u8(4)   # winner declared
STATE_CANCELLED  = u8(5)   # cancelled or AI failed

ZERO_ADDR_STR = "0x" + "0" * 40


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


class TriviaRoyale(gl.Contract):
    matches: TreeMap[u64, TriviaMatch]
    next_match_id: u64
    open_ids_json: str    # JSON [u64] matches in WAITING state
    active_ids_json: str  # JSON [u64] matches in IN_PROGRESS or GENERATING
    user_registry_address: Address

    def __init__(self, user_registry_address: Address) -> None:
        self.next_match_id = u64(0)
        self.open_ids_json = "[]"
        self.active_ids_json = "[]"
        if not isinstance(user_registry_address, Address):
            user_registry_address = Address(user_registry_address)
        self.user_registry_address = user_registry_address

    # ── helpers ───────────────────────────────────────────────────────────────

    def _save(self, mid: u64, m: TriviaMatch) -> None:
        self.matches[mid] = m

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

    # ── write methods ─────────────────────────────────────────────────────────

    @gl.public.write
    def create_match(self, topic: str, max_players: u32 = u32(10)) -> u64:
        if len(topic) == 0 or len(topic) > MAX_TOPIC_LEN:
            raise Exception(f"Topic must be 1-{MAX_TOPIC_LEN} characters")
        if int(max_players) < 2:
            raise Exception("max_players must be at least 2")
        if int(max_players) > MAX_PLAYERS_CAP:
            raise Exception(f"max_players cannot exceed {MAX_PLAYERS_CAP}")

        caller = gl.message.sender_address
        now = int(datetime.datetime.now().timestamp())

        verify_prompt = (
            f'Is the following topic suitable for generating {NUM_QUESTIONS}+ trivia questions '
            f'with publicly verifiable factual answers?\n\n'
            f'Topic: "{topic}"\n\n'
            f'Reject if: the topic is too vague, too personal/private, entirely subjective, '
            f'or has fewer than {NUM_QUESTIONS} publicly known facts.\n'
            f'When in doubt, accept.\n\n'
            f'Start your response with YES or NO, then one sentence of explanation.'
        )
        verify_result = gl.eq_principle.prompt_comparative(
            lambda: gl.nondet.exec_prompt(verify_prompt, response_format='text'),
            'Both outputs start with YES or both outputs start with NO',
        )
        accepted = str(verify_result).strip().upper().startswith("YES")

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
                rejection_reason=str(verify_result).strip(),
                questions_json="[]",
                current_round=u8(0),
                round_answers_json="{}",
                answer_deadline=u64(0),
                winner_str="",
                created_at=u64(now),
            ))
        return match_id

    @gl.public.write
    def join_match(self, match_id: u64) -> None:
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        m = self.matches[match_id]
        if int(m.state) != int(STATE_WAITING):
            raise Exception("Match is not open for joining")
        players = _json_to_addrs(m.players_json)
        if len(players) >= int(m.max_players):
            raise Exception("Match is full")
        if self._index_of(players, caller) >= 0:
            raise Exception("Already joined this match")
        players.append(caller)
        self._save(match_id, TriviaMatch(
            id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
            players_json=_addrs_to_json(players), eliminated_json=m.eliminated_json,
            state=m.state, rejection_reason=m.rejection_reason,
            questions_json=m.questions_json, current_round=m.current_round,
            round_answers_json=m.round_answers_json, answer_deadline=m.answer_deadline,
            winner_str=m.winner_str, created_at=m.created_at,
        ))

    @gl.public.write
    def start_match(self, match_id: u64) -> None:
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        m = self.matches[match_id]
        if int(m.state) != int(STATE_WAITING):
            raise Exception("Match already started or is finished")
        if str(caller).lower() != m.host_str:
            raise Exception("Only the host can start the match")
        players = _json_to_addrs(m.players_json)
        if len(players) < 2:
            raise Exception("Need at least 2 players to start")

        now = int(datetime.datetime.now().timestamp())

        gen_prompt = (
            f'Generate exactly {NUM_QUESTIONS} trivia questions about: "{m.topic}"\n\n'
            f'Format rules:\n'
            f'- Questions 1-11: multiple-choice. 4 options labeled "A) ...", "B) ...", "C) ...", "D) ...". '
            f'  One correct answer (give just the letter: A, B, C, or D).\n'
            f'- Questions 12-15: open-ended. Short factual answer. '
            f'  Give the canonical answer and up to 3 acceptable alternate phrasings.\n'
            f'- Start easy (widely known facts), get harder.\n\n'
            f'Return strict JSON only — no markdown, no explanation:\n'
            f'{{"questions": [\n'
            f'  {{"type": "mc", "text": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], '
            f'"correct_answer": "A", "alternates": []}},\n'
            f'  {{"type": "open", "text": "...", "options": [], '
            f'"correct_answer": "...", "alternates": ["...", "..."]}}\n'
            f']}}'
        )
        result = gl.eq_principle.prompt_comparative(
            lambda: gl.nondet.exec_prompt(gen_prompt, response_format='json'),
            f'Both JSON outputs contain a "questions" array with exactly {NUM_QUESTIONS} items, '
            f'each with a non-empty "text" field and a "type" field',
        )
        if isinstance(result, str):
            result = _json.loads(result)

        questions = result.get('questions', [])
        if len(questions) < NUM_QUESTIONS:
            # Pad with a fallback if AI returned fewer (shouldn't happen often)
            while len(questions) < NUM_QUESTIONS:
                questions.append({
                    "type": "mc",
                    "text": f"Bonus question about {m.topic}: True or false — this topic is interesting?",
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
            created_at=m.created_at,
        ))
        self.open_ids_json = self._remove_id(self.open_ids_json, match_id)
        self.active_ids_json = self._add_id(self.active_ids_json, match_id)

    @gl.public.write
    def submit_answer(self, match_id: u64, answer: str) -> None:
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        m = self.matches[match_id]
        if int(m.state) != int(STATE_IN_PROGRESS):
            raise Exception("Match is not in progress")
        players = _json_to_addrs(m.players_json)
        eliminated = _json_to_addrs(m.eliminated_json)
        active = self._active_players(players, eliminated)
        if self._index_of(active, caller) < 0:
            raise Exception("You are not an active player in this match")
        now = int(datetime.datetime.now().timestamp())
        if int(m.answer_deadline) > 0 and now > int(m.answer_deadline):
            raise Exception("Answer deadline has passed")
        round_answers = _json.loads(m.round_answers_json) if m.round_answers_json else {}
        round_answers[str(caller).lower()] = str(answer)
        self._save(match_id, TriviaMatch(
            id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
            players_json=m.players_json, eliminated_json=m.eliminated_json,
            state=m.state, rejection_reason=m.rejection_reason,
            questions_json=m.questions_json, current_round=m.current_round,
            round_answers_json=_json.dumps(round_answers),
            answer_deadline=m.answer_deadline,
            winner_str=m.winner_str, created_at=m.created_at,
        ))

    @gl.public.write
    def resolve_round(self, match_id: u64) -> None:
        if match_id not in self.matches:
            raise Exception("Match not found")
        m = self.matches[match_id]
        if int(m.state) != int(STATE_IN_PROGRESS):
            raise Exception("Match is not in progress")

        players = _json_to_addrs(m.players_json)
        eliminated = _json_to_addrs(m.eliminated_json)
        active = self._active_players(players, eliminated)

        now = int(datetime.datetime.now().timestamp())
        deadline_passed = int(m.answer_deadline) > 0 and now > int(m.answer_deadline)
        round_answers = _json.loads(m.round_answers_json) if m.round_answers_json else {}
        all_answered = all(str(p).lower() in round_answers for p in active)

        if not deadline_passed and not all_answered:
            raise Exception("Waiting for all players to answer or deadline to pass")

        questions = _json.loads(m.questions_json)
        round_idx = int(m.current_round)
        if round_idx >= len(questions):
            raise Exception("No more questions")
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
            verify_prompt = (
                f'Trivia question: "{q.get("text", "")}"\n'
                f'Correct answer: "{correct_answer}"\n'
                f'Also acceptable: {alternates}\n\n'
                f'For each numbered player below, determine if their answer is correct.\n'
                f'Be lenient: accept minor typos, common abbreviations, alternate valid phrasings.\n'
                f'Reject: wrong entity, completely different meaning, empty string, or gibberish.\n\n'
                f'{answers_block}\n\n'
                f'Return JSON only, no markdown: {{"results": [true_or_false_per_player_in_order]}}'
            )
            verify_result = gl.eq_principle.prompt_comparative(
                lambda: gl.nondet.exec_prompt(verify_prompt, response_format='json'),
                'Both JSON outputs have a "results" array with identical boolean values in the same order',
            )
            if isinstance(verify_result, str):
                verify_result = _json.loads(verify_result)
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
            # One winner
            winner = survivors[0]
            self._save(match_id, TriviaMatch(
                id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
                players_json=m.players_json,
                eliminated_json=_addrs_to_json(elim_list),
                state=STATE_ENDED, rejection_reason="",
                questions_json=m.questions_json, current_round=u8(new_round % 256),
                round_answers_json="{}",
                answer_deadline=u64(0),
                winner_str=str(winner).lower(), created_at=m.created_at,
            ))
            self.active_ids_json = self._remove_id(self.active_ids_json, match_id)
            registry = gl.get_contract_at(self.user_registry_address)
            for p in players:
                is_winner = str(p).lower() == str(winner).lower()
                registry.emit().record_match(p, is_winner)
        elif len(survivors) == 0:
            # All wrong — no one eliminated this round; advance without eliminating
            if new_round >= len(questions):
                # Out of questions, pick the last surviving player by join order
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
                    winner_str="", created_at=m.created_at,
                ))
        else:
            # 2+ survivors — advance to next round
            if new_round >= len(questions):
                # Out of questions — pick first survivor by join order as winner
                winner = survivors[0]
                self._save(match_id, TriviaMatch(
                    id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
                    players_json=m.players_json,
                    eliminated_json=_addrs_to_json(elim_list),
                    state=STATE_ENDED, rejection_reason="",
                    questions_json=m.questions_json, current_round=u8(new_round % 256),
                    round_answers_json="{}",
                    answer_deadline=u64(0),
                    winner_str=str(winner).lower(), created_at=m.created_at,
                ))
                self.active_ids_json = self._remove_id(self.active_ids_json, match_id)
                registry = gl.get_contract_at(self.user_registry_address)
                for p in players:
                    is_winner = str(p).lower() == str(winner).lower()
                    registry.emit().record_match(p, is_winner)
            else:
                self._save(match_id, TriviaMatch(
                    id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
                    players_json=m.players_json,
                    eliminated_json=_addrs_to_json(elim_list),
                    state=STATE_IN_PROGRESS, rejection_reason="",
                    questions_json=m.questions_json, current_round=u8(new_round % 256),
                    round_answers_json="{}",
                    answer_deadline=u64(new_deadline),
                    winner_str="", created_at=m.created_at,
                ))

    @gl.public.write
    def cancel_match(self, match_id: u64) -> None:
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        m = self.matches[match_id]
        if int(m.state) != int(STATE_WAITING):
            raise Exception("Can only cancel a match that is waiting for players")
        if str(caller).lower() != m.host_str:
            raise Exception("Only the host can cancel")
        self._save(match_id, TriviaMatch(
            id=m.id, host_str=m.host_str, topic=m.topic, max_players=m.max_players,
            players_json=m.players_json, eliminated_json=m.eliminated_json,
            state=STATE_CANCELLED, rejection_reason="Cancelled by host",
            questions_json=m.questions_json, current_round=m.current_round,
            round_answers_json=m.round_answers_json, answer_deadline=m.answer_deadline,
            winner_str=m.winner_str, created_at=m.created_at,
        ))
        self.open_ids_json = self._remove_id(self.open_ids_json, match_id)

    # ── view methods ──────────────────────────────────────────────────────────

    @gl.public.view
    def get_match(self, match_id: u64) -> Optional[TriviaMatch]:
        if match_id not in self.matches:
            return None
        return self.matches[match_id]

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
            m = self.matches[u64(i)]
            players = _json_to_addrs(m.players_json)
            if self._index_of(players, player) >= 0:
                result.append(u64(i))
        return result

    @gl.public.view
    def get_current_question(self, match_id: u64) -> str:
        if match_id not in self.matches:
            return "{}"
        m = self.matches[match_id]
        questions = _json.loads(m.questions_json) if m.questions_json and m.questions_json != "[]" else []
        idx = int(m.current_round)
        if idx < len(questions):
            return _json.dumps(questions[idx])
        return "{}"
