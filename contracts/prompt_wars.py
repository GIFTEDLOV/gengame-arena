# { "Depends": "py-genlayer:1j12s63yfjpva9ik2xgnffgrs6v44y1f52jvj9w7xvdn7qckd379" }
from genlayer import *
from dataclasses import dataclass
from typing import Optional
import datetime
import hashlib
import json as _json

TARGETS = [
    "A prompt that produces a 4-line poem about silence",
    "A prompt that produces instructions for making perfect scrambled eggs in under 50 words",
    "A prompt that produces a riddle whose answer is 'a mirror'",
    "A prompt that produces a haiku about autumn leaves falling in a city park",
    "A prompt that produces a one-sentence summary of the French Revolution",
    "A prompt that produces a limerick about a programmer debugging at 3am",
    "A prompt that produces a children's bedtime story in exactly 3 sentences",
    "A prompt that produces the opening line of a gothic horror novel",
    "A prompt that produces advice for someone learning to ride a bicycle",
    "A prompt that produces a tweet-length explanation of photosynthesis",
    "A prompt that produces a recipe for friendship written as a cooking recipe",
    "A prompt that produces a definition of 'home' without using the word 'house'",
    "A prompt that produces a description of rain using only the five senses",
    "A prompt that produces a motivational quote about perseverance under 20 words",
    "A prompt that produces a two-sentence story with a surprise twist ending",
    "A prompt that produces the moral of the story of Icarus in one sentence",
    "A prompt that produces a metaphor comparing the internet to something in nature",
    "A prompt that produces a 5-step morning mindfulness routine",
    "A prompt that produces a joke requiring knowledge of both history and science",
    "A prompt that produces a description of loneliness from a lighthouse's point of view",
    "A prompt that produces an argument for why cats are better pets than dogs",
    "A prompt that produces a list of 5 things that are both beautiful and terrifying",
    "A prompt that produces an explanation of blockchain suitable for a 10-year-old",
    "A prompt that produces a short dialogue between the sun and the moon",
    "A prompt that produces a unique book title about time travel",
    "A prompt that produces a 6-word story about regret",
    "A prompt that produces a description of the color blue to someone born blind",
    "A prompt that produces advice for someone starting their first day at a new job",
    "A prompt that produces a superhero origin story in exactly 4 sentences",
    "A prompt that produces a wedding toast for two people who met at a hackathon",
]

ZERO_ADDR = Address(bytes(20))
DEADLINE_UNSET = u64(0)   # Timer hasn't started yet (match not full / not started)
MAX_PLAYERS_CAP = 50      # Hard upper limit on match size

# Match states
STATE_WAITING   = u8(0)  # Created, accepting joins, no timer yet
STATE_FULL      = u8(1)  # All slots filled OR manually started; 5-min clock running
STATE_JUDGED    = u8(2)
STATE_CANCELLED = u8(3)


# ── JSON helpers for variable-length arrays ───────────────────────────────────
# GenLayer's storage system requires scalar types (str, int, Address…) or
# TreeMap/DynArray for collections. DynArray can't be constructed with initial
# values in write methods, so we serialise player/prompt lists as JSON strings
# and parse them back at the top of every method that needs them.

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
class Match:
    id: u64
    target_text: str
    max_players: u32
    # Variable-length arrays stored as JSON strings (DynArray construction
    # with initial values is not supported; str is the safe storage primitive).
    players_json: str    # [hex_addr, …] ordered by join time
    prompts_json: str    # prompts[i] belongs to players[i]; "" = not submitted
    outputs_json: str    # simulated LLM outputs after judging
    ranking_json: str    # [hex_addr, …] ranking[0] = winner; "" until JUDGED
    state: u8
    judge_reasoning: str
    created_at: u64
    submission_deadline: u64  # DEADLINE_UNSET until match is full/started


class PromptWars(gl.Contract):
    matches: TreeMap[u64, Match]
    next_match_id: u64
    user_registry_address: Address

    def __init__(self, user_registry_address: Address) -> None:
        self.next_match_id = u64(0)
        if not isinstance(user_registry_address, Address):
            user_registry_address = Address(user_registry_address)
        self.user_registry_address = user_registry_address

    # ── private helpers ───────────────────────────────────────────────────────

    def _index_of(self, players: list, addr: Address) -> int:
        for i, p in enumerate(players):
            if p == addr:
                return i
        return -1

    def _save_match(self, match_id: u64, m: Match) -> None:
        self.matches[match_id] = m

    def _start_clock(
        self,
        match_id: u64,
        match: Match,
        players: list,
        prompts: list,
        outputs: list,
        ranking: list,
    ) -> None:
        """Transition to FULL and start the 5-minute submission clock."""
        now = int(datetime.datetime.now().timestamp())
        self._save_match(match_id, Match(
            id=match.id,
            target_text=match.target_text,
            max_players=match.max_players,
            players_json=_addrs_to_json(players),
            prompts_json=_strs_to_json(prompts),
            outputs_json=_strs_to_json(outputs),
            ranking_json=_addrs_to_json(ranking),
            state=STATE_FULL,
            judge_reasoning=match.judge_reasoning,
            created_at=match.created_at,
            submission_deadline=u64(now + 300),
        ))

    # ── write methods ─────────────────────────────────────────────────────────

    @gl.public.write
    def create_match(self, max_players: u32 = u32(50)) -> u64:
        if int(max_players) < 2:
            raise Exception("max_players must be at least 2")
        if int(max_players) > MAX_PLAYERS_CAP:
            raise Exception("max_players cannot exceed 50")

        caller = gl.message.sender_address
        now = int(datetime.datetime.now().timestamp())

        seed_bytes = hashlib.sha256(
            caller.as_bytes + now.to_bytes(8, 'big')
        ).digest()
        target_idx = int.from_bytes(seed_bytes[:4], 'big') % len(TARGETS)
        target_text = TARGETS[target_idx]

        match_id = self.next_match_id
        self._save_match(match_id, Match(
            id=match_id,
            target_text=target_text,
            max_players=max_players,
            players_json=_addrs_to_json([caller]),
            prompts_json=_strs_to_json([""]),
            outputs_json=_strs_to_json([""]),
            ranking_json="[]",
            state=STATE_WAITING,
            judge_reasoning="",
            created_at=u64(now),
            submission_deadline=DEADLINE_UNSET,
        ))
        self.next_match_id = u64(int(match_id) + 1)
        return match_id

    @gl.public.write
    def join_match(self, match_id: u64) -> None:
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        match = self.matches[match_id]

        if int(match.state) != int(STATE_WAITING):
            raise Exception("Match is not open for joining")

        players = _json_to_addrs(match.players_json)
        prompts = _json_to_strs(match.prompts_json)
        outputs = _json_to_strs(match.outputs_json)
        ranking = _json_to_addrs(match.ranking_json)

        if len(players) >= int(match.max_players):
            raise Exception("Match is full")
        if self._index_of(players, caller) >= 0:
            raise Exception("Already joined this match")

        players.append(caller)
        prompts.append("")
        outputs.append("")

        self._save_match(match_id, Match(
            id=match.id,
            target_text=match.target_text,
            max_players=match.max_players,
            players_json=_addrs_to_json(players),
            prompts_json=_strs_to_json(prompts),
            outputs_json=_strs_to_json(outputs),
            ranking_json=match.ranking_json,
            state=match.state,
            judge_reasoning=match.judge_reasoning,
            created_at=match.created_at,
            submission_deadline=match.submission_deadline,
        ))

    @gl.public.write
    def start_match(self, match_id: u64) -> None:
        """Only the host (players[0]) can start the match."""
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        match = self.matches[match_id]

        if int(match.state) != int(STATE_WAITING):
            raise Exception("Match has already started or is finished")

        players = _json_to_addrs(match.players_json)
        prompts = _json_to_strs(match.prompts_json)
        outputs = _json_to_strs(match.outputs_json)
        ranking = _json_to_addrs(match.ranking_json)

        if len(players) < 2:
            raise Exception("Need at least 2 players to start")
        if players[0] != caller:
            raise Exception("Only the host can start the match")

        self._start_clock(match_id, match, players, prompts, outputs, ranking)

    @gl.public.write
    def submit_prompt(self, match_id: u64, prompt: str) -> None:
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        match = self.matches[match_id]

        if int(match.state) != int(STATE_FULL):
            raise Exception("Match is not in submission phase")

        players = _json_to_addrs(match.players_json)
        prompts = _json_to_strs(match.prompts_json)

        idx = self._index_of(players, caller)
        if idx < 0:
            raise Exception("Not a player in this match")
        if len(prompt) > 500:
            raise Exception("Prompt exceeds 500 characters")

        now = int(datetime.datetime.now().timestamp())
        if int(match.submission_deadline) != 0 and now > int(match.submission_deadline):
            raise Exception("Submission deadline passed")

        prompts[idx] = prompt
        self._save_match(match_id, Match(
            id=match.id,
            target_text=match.target_text,
            max_players=match.max_players,
            players_json=match.players_json,
            prompts_json=_strs_to_json(prompts),
            outputs_json=match.outputs_json,
            ranking_json=match.ranking_json,
            state=match.state,
            judge_reasoning=match.judge_reasoning,
            created_at=match.created_at,
            submission_deadline=match.submission_deadline,
        ))

    @gl.public.write
    def judge_match(self, match_id: u64) -> None:
        if match_id not in self.matches:
            raise Exception("Match not found")
        match = self.matches[match_id]

        if int(match.state) != int(STATE_FULL):
            raise Exception("Match is not in a judgeable state")

        players = _json_to_addrs(match.players_json)
        prompts = _json_to_strs(match.prompts_json)
        n = len(players)

        now = int(datetime.datetime.now().timestamp())
        deadline_passed = int(match.submission_deadline) != 0 and now > int(match.submission_deadline)
        submitted = [p != "" for p in prompts]
        num_submitted = sum(submitted)

        if not deadline_passed and num_submitted < n:
            raise Exception("Waiting for all players to submit or deadline to pass")

        # ── No-contest ──────────────────────────────────────────────────────
        if num_submitted == 0:
            self._save_match(match_id, Match(
                id=match.id,
                target_text=match.target_text,
                max_players=match.max_players,
                players_json=match.players_json,
                prompts_json=match.prompts_json,
                outputs_json=_strs_to_json([""] * n),
                ranking_json="[]",
                state=STATE_JUDGED,
                judge_reasoning="No players submitted before the deadline. No contest — no stats recorded.",
                created_at=match.created_at,
                submission_deadline=match.submission_deadline,
            ))
            return

        # ── Two-player forfeit (only 1 of 2 submitted) ──────────────────────
        if num_submitted == 1 and n == 2:
            winner_idx = 0 if submitted[0] else 1
            loser_idx = 1 - winner_idx
            ranking = [players[winner_idx], players[loser_idx]]
            self._save_match(match_id, Match(
                id=match.id,
                target_text=match.target_text,
                max_players=match.max_players,
                players_json=match.players_json,
                prompts_json=match.prompts_json,
                outputs_json=_strs_to_json([""] * n),
                ranking_json=_addrs_to_json(ranking),
                state=STATE_JUDGED,
                judge_reasoning="Opponent did not submit before the deadline. Win awarded by forfeit.",
                created_at=match.created_at,
                submission_deadline=match.submission_deadline,
            ))
            registry = gl.get_contract_at(self.user_registry_address)
            registry.emit().record_match_batch([
                {"player": str(players[winner_idx]), "rank": 1, "total_players": 2},
                {"player": str(players[loser_idx]),  "rank": 2, "total_players": 2},
            ])
            return

        # ── AI judging: rank all players ────────────────────────────────────
        target = match.target_text
        prompt_lines = []
        for i in range(n):
            p = prompts[i]
            prompt_lines.append(f"Player {i + 1}: \"{p}\"" if p else f"Player {i + 1}: [did not submit]")
        prompts_block = "\n".join(prompt_lines)

        judge_prompt = (
            f'You are judging a "Prompt Wars" match with {n} players.\n\n'
            f'Target task: "{target}"\n\n'
            f'Player submissions:\n{prompts_block}\n\n'
            f'Instructions:\n'
            f'1. Simulate running each submitted prompt through an AI.\n'
            f'2. Compare every simulated output against the target task.\n'
            f'3. Rank all {n} players from best to worst. Players who did not submit rank last.\n\n'
            f'Respond with valid JSON only (no markdown fences):\n'
            f'{{"ranking": [1-based player numbers best first], '
            f'"outputs": {{"1": "output for player 1", "2": "output for player 2", ...}}, '
            f'"reasoning": "brief explanation of ranking"}}'
        )

        result = gl.eq_principle.prompt_comparative(
            lambda: gl.nondet.exec_prompt(judge_prompt, response_format='json'),
            'The "ranking" list (the ordered sequence of 1-based player numbers) is identical in both JSON outputs',
        )

        if isinstance(result, str):
            result = _json.loads(result)

        ranking_nums = [int(x) for x in result['ranking']]
        outputs_map = {str(k): str(v) for k, v in result.get('outputs', {}).items()}
        reasoning = str(result.get('reasoning', ''))

        new_outputs = [""] * n
        for i in range(n):
            new_outputs[i] = outputs_map.get(str(i + 1), "")

        ranking_addrs = []
        for num in ranking_nums:
            idx = num - 1
            if 0 <= idx < n:
                ranking_addrs.append(players[idx])

        self._save_match(match_id, Match(
            id=match.id,
            target_text=match.target_text,
            max_players=match.max_players,
            players_json=match.players_json,
            prompts_json=match.prompts_json,
            outputs_json=_strs_to_json(new_outputs),
            ranking_json=_addrs_to_json(ranking_addrs),
            state=STATE_JUDGED,
            judge_reasoning=reasoning,
            created_at=match.created_at,
            submission_deadline=match.submission_deadline,
        ))

        registry = gl.get_contract_at(self.user_registry_address)
        entries = [{"player": str(addr), "rank": rank_i + 1, "total_players": len(ranking_addrs)}
                   for rank_i, addr in enumerate(ranking_addrs)]
        registry.emit().record_match_batch(entries)

    @gl.public.write
    def cancel_match(self, match_id: u64) -> None:
        """Cancel a match still waiting for players (creator only, 5+ min after create)."""
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        match = self.matches[match_id]

        players = _json_to_addrs(match.players_json)
        if players[0] != caller:
            raise Exception("Only the match creator can cancel")
        if int(match.state) != int(STATE_WAITING):
            raise Exception("Can only cancel a match that is still waiting for players")

        now = int(datetime.datetime.now().timestamp())
        if now <= int(match.created_at) + 300:
            raise Exception("Can only cancel after the deadline has passed")

        self._save_match(match_id, Match(
            id=match.id,
            target_text=match.target_text,
            max_players=match.max_players,
            players_json=match.players_json,
            prompts_json=match.prompts_json,
            outputs_json=match.outputs_json,
            ranking_json=match.ranking_json,
            state=STATE_CANCELLED,
            judge_reasoning="",
            created_at=match.created_at,
            submission_deadline=match.submission_deadline,
        ))

    # ── view methods ──────────────────────────────────────────────────────────

    @gl.public.view
    def get_match(self, match_id: u64) -> Optional[Match]:
        if match_id not in self.matches:
            return None
        return self.matches[match_id]

    @gl.public.view
    def get_recent_matches(self, limit: u32) -> list[Match]:
        total = int(self.next_match_id)
        limit_int = int(limit)
        result = []
        start = max(0, total - limit_int)
        for i in range(total - 1, start - 1, -1):
            result.append(self.matches[u64(i)])
        return result

    @gl.public.view
    def get_matches_for_player(self, player: Address) -> list[u64]:
        if not isinstance(player, Address):
            player = Address(player)
        result = []
        for i in range(int(self.next_match_id)):
            match = self.matches[u64(i)]
            players = _json_to_addrs(match.players_json)
            if self._index_of(players, player) >= 0:
                result.append(u64(i))
        return result
