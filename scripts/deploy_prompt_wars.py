"""
Deploy contracts/prompt_wars.py to GenLayer localnet and print the contract address.

Usage:
    python scripts/deploy_prompt_wars.py [--rpc <url>] [--private-key <hex>] [--user-registry <address>]

Defaults to localnet at http://localhost:4000/api using Hardhat account #0.
"""
import argparse
import subprocess
import sys
from pathlib import Path

USER_REGISTRY_ADDRESS = "0x698321Bb07b4536Cdc1DB7e7095eaB554feaE42b"


def main():
    parser = argparse.ArgumentParser(description="Deploy PromptWars contract")
    parser.add_argument("--rpc", default="http://localhost:4000/api")
    parser.add_argument(
        "--private-key",
        default="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    )
    parser.add_argument("--user-registry", default=USER_REGISTRY_ADDRESS)
    args = parser.parse_args()

    contract_path = Path(__file__).parent.parent / "contracts" / "prompt_wars.py"
    if not contract_path.exists():
        print(f"Error: contract not found at {contract_path}", file=sys.stderr)
        sys.exit(1)

    cmd = [
        "genlayer",
        "deploy",
        "--contract",
        str(contract_path),
        "--args",
        args.user_registry,
        "--rpc",
        args.rpc,
    ]

    print(f"Deploying {contract_path.name} to {args.rpc} ...")
    print(f"  user_registry_address = {args.user_registry}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    output = result.stdout + result.stderr
    # Parse contract address from output
    for line in output.splitlines():
        if "Contract Address" in line or "contract address" in line.lower():
            parts = line.split(":")
            if len(parts) >= 2:
                addr = parts[-1].strip().strip("'\"")
                print(f"Contract deployed at: {addr}")
                return

    print("Deploy output:")
    print(output)
    if result.returncode != 0:
        print("Exit code:", result.returncode, file=sys.stderr)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
