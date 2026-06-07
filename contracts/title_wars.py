# { "Depends": "py-genlayer:1j12s63yfjpva9ik2xgnffgrs6v44y1f52jvj9w7xvdn7qckd379" }
from genlayer import *
from dataclasses import dataclass
from typing import Optional
import datetime
import json as _json

MAX_PLAYERS_CAP  = 50
MAX_EXCERPT_LEN  = 1500
MIN_EXCERPT_LEN  = 10
MAX_TITLE_LEN    = 100
SUBMISSION_SECS  = 180   # 3 minutes

# Match states
STATE_WAITING    = u8(0)   # lobby, accepting joins
STATE_REJECTED   = u8(1)   # excerpt failed verifiability check
STATE_OPEN       = u8(2)   # host started, collecting title submissions
STATE_JUDGING    = u8(3)   # judging in progress (reserved; judging is synchronous)
STATE_JUDGED     = u8(4)   # done, ranking available
STATE_CANCELLED  = u8(5)   # host cancelled before play


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


def _ints_to_json(nums: list) -> str:
    return _json.dumps(list(nums))


def _json_to_ints(s: str) -> list:
    if not s or s == "[]":
        return []
    return _json.loads(s)


@allow_storage
@dataclass
class TitleMatch:
    id: u64
    host_str: str                  # host address as lowercase hex
    excerpt: str                   # max 1500 chars
    max_players: u32
    players_json: str              # JSON [hex_addr, ...] in join order
    titles_json: str               # JSON [str, ...] parallel to players; "" until submitted
    submission_times_json: str     # JSON [int, ...] timestamps; 0 until submitted
    state: u8
    rejection_reason: str          # set when state == REJECTED
    submission_deadline: u64       # set when host starts; 0 = not started
    ranking_json: str              # JSON [hex_addr, ...] best-to-worst after judging
    judge_reasoning_json: str      # JSON [str, ...] one line per rank after judging
    created_at: u64


class TitleWars(gl.Contract):
    matches: TreeMap[u64, TitleMatch]
    next_match_id: u64
    open_ids_json: str     # JSON [u64] matches in WAITING state
    judged_ids_json: str   # JSON [u64] matches in JUDGED state
    user_registry_address: Address

    def __init__(self, user_registry_address: Address) -> None:
        self.next_match_id = u64(0)
        self.open_ids_json = "[]"
        self.judged_ids_json = "[]"
        if not isinstance(user_registry_address, Address):
            user_registry_address = Address(user_registry_address)
        self.user_registry_address = user_registry_address

    # ── helpers ───────────────────────────────────────────────────────────────

    def _save(self, mid: u64, m: TitleMatch) -> None:
        self.matches[mid] = m

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

    def _strip_fences(self, text: str) -> str:
        s = text.strip()
        if s.startswith('```'):
            lines = s.splitlines()
            lines = [l for l in lines if not l.strip().startswith('```')]
            s = '\n'.join(lines).strip()
        return s

    # ── write methods ─────────────────────────────────────────────────────────

    @gl.public.write
    def create_match(self, excerpt: str, max_players: u32 = u32(50)) -> u64:
        if len(excerpt) < MIN_EXCERPT_LEN or len(excerpt) > MAX_EXCERPT_LEN:
            raise Exception(f"Excerpt must be {MIN_EXCERPT_LEN}–{MAX_EXCERPT_LEN} characters")
        if int(max_players) < 2:
            raise Exception("max_players must be at least 2")
        if int(max_players) > MAX_PLAYERS_CAP:
            raise Exception(f"max_players cannot exceed {MAX_PLAYERS_CAP}")

        caller = gl.message.sender_address
        now = int(datetime.datetime.now().timestamp())

        verify_prompt = (
            f'Is the following text a coherent literary excerpt (prose or poetry) suitable for '
            f'a title contest? Reject lists, instructions, code, or gibberish. When in doubt, accept.\n\n'
            f'Text:\n"""\n{excerpt}\n"""\n\n'
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
            self._save(match_id, TitleMatch(
                id=match_id,
                host_str=str(caller).lower(),
                excerpt=excerpt,
                max_players=max_players,
                players_json=_addrs_to_json([caller]),
                titles_json=_strs_to_json([""]),
                submission_times_json=_ints_to_json([0]),
                state=STATE_WAITING,
                rejection_reason="",
                submission_deadline=u64(0),
                ranking_json="[]",
                judge_reasoning_json="[]",
                created_at=u64(now),
            ))
            self.open_ids_json = self._add_id(self.open_ids_json, match_id)
        else:
            self._save(match_id, TitleMatch(
                id=match_id,
                host_str=str(caller).lower(),
                excerpt=excerpt,
                max_players=max_players,
                players_json=_addrs_to_json([caller]),
                titles_json=_strs_to_json([""]),
                submission_times_json=_ints_to_json([0]),
                state=STATE_REJECTED,
                rejection_reason=str(verify_result).strip(),
                submission_deadline=u64(0),
                ranking_json="[]",
                judge_reasoning_json="[]",
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
        titles = _json_to_strs(m.titles_json)
        titles.append("")
        times = _json_to_ints(m.submission_times_json)
        times.append(0)
        self._save(match_id, TitleMatch(
            id=m.id, host_str=m.host_str, excerpt=m.excerpt, max_players=m.max_players,
            players_json=_addrs_to_json(players),
            titles_json=_strs_to_json(titles),
            submission_times_json=_ints_to_json(times),
            state=m.state, rejection_reason=m.rejection_reason,
            submission_deadline=m.submission_deadline,
            ranking_json=m.ranking_json,
            judge_reasoning_json=m.judge_reasoning_json,
            created_at=m.created_at,
        ))

    @gl.public.write
    def start_match(self, match_id: u64) -> None:
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        m = self.matches[match_id]
        if int(m.state) != int(STATE_WAITING):
            raise Exception("Match has already started or is finished")
        if str(caller).lower() != m.host_str:
            raise Exception("Only the host can start the match")
        players = _json_to_addrs(m.players_json)
        if len(players) < 2:
            raise Exception("Need at least 2 players to start")
        now = int(datetime.datetime.now().timestamp())
        deadline = now + SUBMISSION_SECS
        self._save(match_id, TitleMatch(
            id=m.id, host_str=m.host_str, excerpt=m.excerpt, max_players=m.max_players,
            players_json=m.players_json,
            titles_json=m.titles_json,
            submission_times_json=m.submission_times_json,
            state=STATE_OPEN, rejection_reason="",
            submission_deadline=u64(deadline),
            ranking_json=m.ranking_json,
            judge_reasoning_json=m.judge_reasoning_json,
            created_at=m.created_at,
        ))
        self.open_ids_json = self._remove_id(self.open_ids_json, match_id)

    @gl.public.write
    def submit_title(self, match_id: u64, title: str) -> None:
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        m = self.matches[match_id]
        if int(m.state) != int(STATE_OPEN):
            raise Exception("Match is not accepting submissions")
        if len(title) > MAX_TITLE_LEN:
            raise Exception(f"Title must be at most {MAX_TITLE_LEN} characters")
        players = _json_to_addrs(m.players_json)
        idx = self._index_of(players, caller)
        if idx < 0:
            raise Exception("You are not a player in this match")
        now = int(datetime.datetime.now().timestamp())
        if int(m.submission_deadline) > 0 and now > int(m.submission_deadline):
            raise Exception("Submission deadline has passed")
        titles = _json_to_strs(m.titles_json)
        times = _json_to_ints(m.submission_times_json)
        titles[idx] = title
        times[idx] = now
        self._save(match_id, TitleMatch(
            id=m.id, host_str=m.host_str, excerpt=m.excerpt, max_players=m.max_players,
            players_json=m.players_json,
            titles_json=_strs_to_json(titles),
            submission_times_json=_ints_to_json(times),
            state=m.state, rejection_reason=m.rejection_reason,
            submission_deadline=m.submission_deadline,
            ranking_json=m.ranking_json,
            judge_reasoning_json=m.judge_reasoning_json,
            created_at=m.created_at,
        ))

    @gl.public.write
    def judge_match(self, match_id: u64) -> None:
        if match_id not in self.matches:
            raise Exception("Match not found")
        m = self.matches[match_id]
        if int(m.state) != int(STATE_OPEN):
            raise Exception("Match is not in a judgeable state")

        players = _json_to_addrs(m.players_json)
        titles = _json_to_strs(m.titles_json)
        n = len(players)

        now = int(datetime.datetime.now().timestamp())
        deadline_passed = int(m.submission_deadline) > 0 and now > int(m.submission_deadline)
        all_submitted = all(t != "" for t in titles)

        if not deadline_passed and not all_submitted:
            raise Exception("Waiting for all players to submit or deadline to pass")

        # Build the judge prompt
        title_lines = []
        for i in range(n):
            t = titles[i] if titles[i] else "[did not submit]"
            title_lines.append(f"{i + 1}. {t}")
        titles_block = "\n".join(title_lines)

        judge_prompt = (
            f'You are judging a title submission contest. The excerpt is:\n\n'
            f'"""\n{m.excerpt}\n"""\n\n'
            f'The following titles were submitted by {n} players:\n{titles_block}\n\n'
            f'Rank all {n} titles from best to worst by these criteria:\n'
            f'- Thematic fit: does the title capture the core meaning, mood, or imagery?\n'
            f'- Creativity: is it surprising, evocative, or memorable — not generic?\n'
            f'- Concision: short and punchy beats long and explanatory\n'
            f'- Avoid spoilers: hints at depth without giving the ending away\n\n'
            f'Players who did not submit a title automatically rank last.\n\n'
            f'Return JSON only — no markdown fences:\n'
            f'{{"ranking": [1-based player numbers best first], '
            f'"reasoning": ["one sentence per rank position in ranking order"]}}'
        )

        result = gl.eq_principle.prompt_comparative(
            lambda: gl.nondet.exec_prompt(judge_prompt, response_format='text'),
            'The "ranking" list (the ordered sequence of 1-based player numbers) is identical in both JSON outputs',
        )

        if isinstance(result, str):
            result = _json.loads(self._strip_fences(result))

        ranking_nums = [int(x) for x in result.get('ranking', [])]
        reasoning_list = [str(r) for r in result.get('reasoning', [])]

        # Map 1-based player numbers to addresses
        ranking_addrs = []
        for num in ranking_nums:
            idx = num - 1
            if 0 <= idx < n:
                ranking_addrs.append(str(players[idx]).lower())

        # Append any players missing from the AI ranking (non-submitters ranked last)
        ranked_set = set(ranking_addrs)
        for p in players:
            ps = str(p).lower()
            if ps not in ranked_set:
                ranking_addrs.append(ps)

        # Pad reasoning to match ranking length
        while len(reasoning_list) < len(ranking_addrs):
            reasoning_list.append("")

        self._save(match_id, TitleMatch(
            id=m.id, host_str=m.host_str, excerpt=m.excerpt, max_players=m.max_players,
            players_json=m.players_json,
            titles_json=m.titles_json,
            submission_times_json=m.submission_times_json,
            state=STATE_JUDGED, rejection_reason="",
            submission_deadline=m.submission_deadline,
            ranking_json=_strs_to_json(ranking_addrs),
            judge_reasoning_json=_strs_to_json(reasoning_list),
            created_at=m.created_at,
        ))
        self.judged_ids_json = self._add_id(self.judged_ids_json, match_id)

        registry = gl.get_contract_at(self.user_registry_address)
        for rank_i, addr in enumerate(ranking_addrs):
            registry.emit().record_match(Address(addr), rank_i == 0)

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
        self._save(match_id, TitleMatch(
            id=m.id, host_str=m.host_str, excerpt=m.excerpt, max_players=m.max_players,
            players_json=m.players_json,
            titles_json=m.titles_json,
            submission_times_json=m.submission_times_json,
            state=STATE_CANCELLED, rejection_reason="Cancelled by host",
            submission_deadline=m.submission_deadline,
            ranking_json=m.ranking_json,
            judge_reasoning_json=m.judge_reasoning_json,
            created_at=m.created_at,
        ))
        self.open_ids_json = self._remove_id(self.open_ids_json, match_id)

    # ── view methods ──────────────────────────────────────────────────────────

    @gl.public.view
    def get_match(self, match_id: u64) -> Optional[TitleMatch]:
        if match_id not in self.matches:
            return None
        return self.matches[match_id]

    @gl.public.view
    def get_open_matches(self, limit: u32) -> list[u64]:
        ids = _json_to_strs(self.open_ids_json)
        ids.reverse()
        return [u64(x) for x in ids[:int(limit)]]

    @gl.public.view
    def get_judged_matches(self, limit: u32) -> list[u64]:
        ids = _json_to_strs(self.judged_ids_json)
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
    def get_next_match_id(self) -> u64:
        return self.next_match_id
