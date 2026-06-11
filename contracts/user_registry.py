# { "Depends": "py-genlayer:1j12s63yfjpva9ik2xgnffgrs6v44y1f52jvj9w7xvdn7qckd379" }
from genlayer import *
from dataclasses import dataclass
from typing import Optional
import re


@allow_storage
@dataclass
class UserProfile:
    username: str
    joined_at: u64
    total_matches: u32
    total_wins: u32


class UserRegistry(gl.Contract):
    profiles: TreeMap[Address, UserProfile]
    username_to_address: TreeMap[str, Address]

    def __init__(self) -> None:
        pass

    def _validate_username(self, username: str) -> None:
        if not (3 <= len(username) <= 20):
            raise gl.vm.UserError("Username must be between 3 and 20 characters")
        if not re.match(r'^[a-zA-Z0-9_]+$', username):
            raise gl.vm.UserError("Username may only contain letters, numbers, and underscores")

    @gl.public.write
    def register_user(self, username: str) -> None:
        caller = gl.message.sender_address
        if caller in self.profiles:
            raise gl.vm.UserError("Address already registered")
        self._validate_username(username)
        key = username.lower()
        if key in self.username_to_address:
            raise gl.vm.UserError("Username already taken")
        # TODO: replace u64(0) with block timestamp once GenLayer context API is confirmed
        self.profiles[caller] = UserProfile(
            username=username,
            joined_at=u64(0),
            total_matches=u32(0),
            total_wins=u32(0),
        )
        self.username_to_address[key] = caller

    @gl.public.write
    def update_username(self, new_username: str) -> None:
        caller = gl.message.sender_address
        if caller not in self.profiles:
            raise gl.vm.UserError("Address not registered")
        self._validate_username(new_username)
        new_key = new_username.lower()
        if new_key in self.username_to_address:
            raise gl.vm.UserError("Username already taken")
        old_profile = self.profiles[caller]
        old_key = old_profile.username.lower()
        del self.username_to_address[old_key]
        self.profiles[caller] = UserProfile(
            username=new_username,
            joined_at=old_profile.joined_at,
            total_matches=old_profile.total_matches,
            total_wins=old_profile.total_wins,
        )
        self.username_to_address[new_key] = caller

    def _record_one(self, player: Address, won: bool) -> None:
        if not isinstance(player, Address):
            player = Address(player)
        if player not in self.profiles:
            raise gl.vm.UserError("Player not registered")
        old = self.profiles[player]
        self.profiles[player] = UserProfile(
            username=old.username,
            joined_at=old.joined_at,
            total_matches=u32(int(old.total_matches) + 1),
            total_wins=u32(int(old.total_wins) + 1) if won else old.total_wins,
        )

    @gl.public.write
    def record_match(self, player: Address, won: bool) -> None:
        # TODO: restrict to whitelisted game contracts once ACL is in place
        self._record_one(player, won)

    @gl.public.write
    def record_match_batch(self, entries: list) -> None:
        for entry in entries:
            player = entry["player"]
            rank = int(entry["rank"])
            self._record_one(player, rank == 1)

    @gl.public.view
    def get_profile(self, addr: Address) -> Optional[UserProfile]:
        if not isinstance(addr, Address):
            addr = Address(addr)
        return self.profiles.get(addr)

    @gl.public.view
    def address_of(self, username: str) -> Optional[Address]:
        return self.username_to_address.get(username.lower())

    @gl.public.view
    def is_username_taken(self, username: str) -> bool:
        return username.lower() in self.username_to_address
