import pytest

ALICE_ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
BOB_ADDR   = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
CAROL_ADDR = "0xcccccccccccccccccccccccccccccccccccccccc"


@pytest.fixture
def contract(direct_deploy):
    return direct_deploy("contracts/user_registry.py")


# ---------------------------------------------------------------------------
# Successful registration + profile readback
# ---------------------------------------------------------------------------

def test_successful_registration_and_readback(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    profile = contract.get_profile(ALICE_ADDR)
    assert profile is not None
    assert profile.username == "Alice"
    assert profile.total_matches == 0
    assert profile.total_wins == 0


# ---------------------------------------------------------------------------
# Duplicate address rejected
# ---------------------------------------------------------------------------

def test_duplicate_address_rejected(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    with direct_vm.expect_revert("Address already registered"):
        contract.register_user("AliasName")


# ---------------------------------------------------------------------------
# Duplicate username rejected (case-insensitive)
# ---------------------------------------------------------------------------

def test_duplicate_username_case_insensitive(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Username already taken"):
        contract.register_user("alice")


def test_duplicate_username_same_case(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Username already taken"):
        contract.register_user("Alice")


# ---------------------------------------------------------------------------
# Invalid usernames rejected
# ---------------------------------------------------------------------------

def test_username_too_short(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username must be between 3 and 20 characters"):
        contract.register_user("ab")


def test_username_too_long(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username must be between 3 and 20 characters"):
        contract.register_user("a" * 21)


def test_username_has_space(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username may only contain letters, numbers, and underscores"):
        contract.register_user("alice bob")


def test_username_has_dash(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username may only contain letters, numbers, and underscores"):
        contract.register_user("alice-bob")


def test_username_has_special_char(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username may only contain letters, numbers, and underscores"):
        contract.register_user("alice@bob")


# ---------------------------------------------------------------------------
# update_username — works and frees old name
# ---------------------------------------------------------------------------

def test_update_username_works_and_frees_old_name(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    contract.update_username("AliceNew")

    profile = contract.get_profile(ALICE_ADDR)
    assert profile.username == "AliceNew"

    # old name "alice" is now free — bob can claim it
    direct_vm.sender = BOB_ADDR
    contract.register_user("Alice")
    bob_profile = contract.get_profile(BOB_ADDR)
    assert bob_profile.username == "Alice"


def test_update_username_rejected_if_not_registered(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Address not registered"):
        contract.update_username("NewName")


def test_update_username_rejected_if_name_taken(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    direct_vm.sender = BOB_ADDR
    contract.register_user("Bob")

    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username already taken"):
        contract.update_username("bob")


# ---------------------------------------------------------------------------
# record_match — correctly increments counters
# ---------------------------------------------------------------------------

def test_record_match_win(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    contract.record_match(ALICE_ADDR, True)

    profile = contract.get_profile(ALICE_ADDR)
    assert profile.total_matches == 1
    assert profile.total_wins == 1


def test_record_match_loss(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    contract.record_match(ALICE_ADDR, False)

    profile = contract.get_profile(ALICE_ADDR)
    assert profile.total_matches == 1
    assert profile.total_wins == 0


def test_record_match_multiple(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    contract.record_match(ALICE_ADDR, True)
    contract.record_match(ALICE_ADDR, False)
    contract.record_match(ALICE_ADDR, True)

    profile = contract.get_profile(ALICE_ADDR)
    assert profile.total_matches == 3
    assert profile.total_wins == 2


def test_record_match_unregistered_player(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Player not registered"):
        contract.record_match(BOB_ADDR, True)


# ---------------------------------------------------------------------------
# get_profile returns None for unregistered address
# ---------------------------------------------------------------------------

def test_get_profile_none_for_unregistered(contract, direct_vm):
    result = contract.get_profile(ALICE_ADDR)
    assert result is None


# ---------------------------------------------------------------------------
# address_of and is_username_taken
# ---------------------------------------------------------------------------

def test_address_of(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    addr = contract.address_of("Alice")
    assert str(addr).lower() == ALICE_ADDR.lower()

    addr_lower = contract.address_of("alice")
    assert str(addr_lower).lower() == ALICE_ADDR.lower()


def test_address_of_unknown_returns_none(contract, direct_vm):
    assert contract.address_of("nobody") is None


def test_is_username_taken(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    assert contract.is_username_taken("Alice") is True
    assert contract.is_username_taken("alice") is True
    assert contract.is_username_taken("Bob") is False
