# { "Depends": "py-genlayer:1j12s63yfjpva9ik2xgnffgrs6v44y1f52jvj9w7xvdn7qckd379" }
from genlayer import *
from dataclasses import dataclass
from typing import Optional
import datetime
import hashlib

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

STATE_WAITING_FOR_P2 = u8(0)
STATE_BOTH_JOINED = u8(1)
STATE_ONE_SUBMITTED = u8(2)
STATE_BOTH_SUBMITTED = u8(3)
STATE_JUDGED = u8(4)


@allow_storage
@dataclass
class Match:
    id: u64
    target_text: str
    player1: Address
    player2: Address
    player1_prompt: str
    player2_prompt: str
    player1_output: str
    player2_output: str
    state: u8
    winner: Address
    judge_reasoning: str
    created_at: u64
    submission_deadline: u64


class PromptWars(gl.Contract):
    matches: TreeMap[u64, Match]
    next_match_id: u64
    user_registry_address: Address

    def __init__(self, user_registry_address: Address) -> None:
        self.next_match_id = u64(0)
        if not isinstance(user_registry_address, Address):
            user_registry_address = Address(user_registry_address)
        self.user_registry_address = user_registry_address

    @gl.public.write
    def create_match(self) -> u64:
        caller = gl.message.sender_address
        now = int(datetime.datetime.now().timestamp())

        # Deterministic target selection from caller address + timestamp
        seed_bytes = hashlib.sha256(
            caller.as_bytes + now.to_bytes(8, 'big')
        ).digest()
        target_idx = int.from_bytes(seed_bytes[:4], 'big') % len(TARGETS)
        target_text = TARGETS[target_idx]

        match_id = self.next_match_id

        self.matches[match_id] = Match(
            id=match_id,
            target_text=target_text,
            player1=caller,
            player2=ZERO_ADDR,
            player1_prompt="",
            player2_prompt="",
            player1_output="",
            player2_output="",
            state=STATE_WAITING_FOR_P2,
            winner=ZERO_ADDR,
            judge_reasoning="",
            created_at=u64(now),
            submission_deadline=u64(now + 300),
        )

        self.next_match_id = u64(int(match_id) + 1)
        return match_id

    @gl.public.write
    def join_match(self, match_id: u64) -> None:
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        match = self.matches[match_id]
        if int(match.state) != 0:
            raise Exception("Match already has two players")
        if match.player1 == caller:
            raise Exception("Cannot join your own match")

        self.matches[match_id] = Match(
            id=match.id,
            target_text=match.target_text,
            player1=match.player1,
            player2=caller,
            player1_prompt=match.player1_prompt,
            player2_prompt=match.player2_prompt,
            player1_output=match.player1_output,
            player2_output=match.player2_output,
            state=STATE_BOTH_JOINED,
            winner=match.winner,
            judge_reasoning=match.judge_reasoning,
            created_at=match.created_at,
            submission_deadline=match.submission_deadline,
        )

    @gl.public.write
    def submit_prompt(self, match_id: u64, prompt: str) -> None:
        caller = gl.message.sender_address
        if match_id not in self.matches:
            raise Exception("Match not found")
        match = self.matches[match_id]

        is_player1 = match.player1 == caller
        is_player2 = match.player2 == caller

        if not (is_player1 or is_player2):
            raise Exception("Not a player in this match")

        state = int(match.state)
        if state < 1 or state > 2:
            raise Exception("Match is not in submission phase")

        if is_player1 and match.player1_prompt != "":
            raise Exception("Already submitted")
        if is_player2 and match.player2_prompt != "":
            raise Exception("Already submitted")

        if len(prompt) > 500:
            raise Exception("Prompt exceeds 500 characters")

        now = int(datetime.datetime.now().timestamp())
        if now > int(match.submission_deadline):
            raise Exception("Submission deadline passed")

        new_p1_prompt = prompt if is_player1 else match.player1_prompt
        new_p2_prompt = prompt if is_player2 else match.player2_prompt

        both_in = new_p1_prompt != "" and new_p2_prompt != ""
        new_state = STATE_BOTH_SUBMITTED if both_in else STATE_ONE_SUBMITTED

        self.matches[match_id] = Match(
            id=match.id,
            target_text=match.target_text,
            player1=match.player1,
            player2=match.player2,
            player1_prompt=new_p1_prompt,
            player2_prompt=new_p2_prompt,
            player1_output=match.player1_output,
            player2_output=match.player2_output,
            state=new_state,
            winner=match.winner,
            judge_reasoning=match.judge_reasoning,
            created_at=match.created_at,
            submission_deadline=match.submission_deadline,
        )

    @gl.public.write
    def judge_match(self, match_id: u64) -> None:
        if match_id not in self.matches:
            raise Exception("Match not found")
        match = self.matches[match_id]

        if int(match.state) != 3:
            raise Exception("Both players must submit before judging")

        target = match.target_text
        p1_prompt = match.player1_prompt
        p2_prompt = match.player2_prompt

        judge_prompt = (
            f'You are judging a "Prompt Wars" match.\n\n'
            f'Target task: "{target}"\n\n'
            f'Player 1 submitted this prompt: "{p1_prompt}"\n'
            f'Player 2 submitted this prompt: "{p2_prompt}"\n\n'
            f'Instructions:\n'
            f'1. Simulate executing each player\'s prompt as if you were an AI receiving it.\n'
            f'2. Compare both simulated outputs to the target task.\n'
            f'3. Determine which player\'s output is semantically closer to the target.\n\n'
            f'Respond with valid JSON only:\n'
            f'{{"player1_output": "what player 1\'s prompt produces", '
            f'"player2_output": "what player 2\'s prompt produces", '
            f'"winner": 1 or 2, '
            f'"reasoning": "why the winner better matched the target"}}'
        )

        # eq_principle ensures all validators agree on the judgment
        result = gl.eq_principle.prompt_comparative(
            lambda: gl.nondet.exec_prompt(judge_prompt, response_format='json'),
            "The winner should be the player whose prompt output is semantically closer to the target task"
        )

        winner_num = int(result['winner'])
        p1_output = str(result.get('player1_output', ''))
        p2_output = str(result.get('player2_output', ''))
        reasoning = str(result.get('reasoning', ''))

        winner_address = match.player1 if winner_num == 1 else match.player2

        self.matches[match_id] = Match(
            id=match.id,
            target_text=match.target_text,
            player1=match.player1,
            player2=match.player2,
            player1_prompt=match.player1_prompt,
            player2_prompt=match.player2_prompt,
            player1_output=p1_output,
            player2_output=p2_output,
            state=STATE_JUDGED,
            winner=winner_address,
            judge_reasoning=reasoning,
            created_at=match.created_at,
            submission_deadline=match.submission_deadline,
        )

        # Cross-contract: record match outcome for both players (PostMessage, outside eq_principle)
        registry = gl.get_contract_at(self.user_registry_address)
        registry.emit().record_match(match.player1, winner_num == 1)
        registry.emit().record_match(match.player2, winner_num == 2)

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
            if match.player1 == player or match.player2 == player:
                result.append(u64(i))
        return result
