"""
Deploy contracts/trivia_royale.py to GenLayer localnet and print the contract address.

Usage:
    python scripts/deploy_trivia_royale.py [--rpc <url>] [--private-key <hex>] [--user-registry <address>]

Defaults to localnet at http://localhost:4000/api using Hardhat account #0.
After deploy, update NEXT_PUBLIC_TRIVIA_ROYALE_ADDRESS in app/.env.local and
TRIVIA_ROYALE_ADDRESS fallback in app/src/lib/genlayer.ts.
"""
import argparse
import subprocess
import sys
from pathlib import Path

USER_REGISTRY_ADDRESS = "0x8704aBA88217a076292bd2Fd3945eb49E4Fc2448"


def main():
    parser = argparse.ArgumentParser(description="Deploy TriviaRoyale contract")
    parser.add_argument("--rpc", default="http://localhost:4000/api")
    parser.add_argument(
        "--private-key",
        default="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    )
    parser.add_argument("--user-registry", default=USER_REGISTRY_ADDRESS)
    args = parser.parse_args()

    contract_path = Path(__file__).parent.parent / "contracts" / "trivia_royale.py"
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
    result = subprocess.run(cmd, capture_output=True, text=True, shell=(sys.platform == "win32"))

    output = result.stdout + result.stderr
    deployed_addr = None
    for line in output.splitlines():
        if "Contract Address" in line or "contract address" in line.lower():
            parts = line.split(":")
            if len(parts) >= 2:
                deployed_addr = parts[-1].strip().strip("'\"")
                print(f"\nContract deployed at: {deployed_addr}")
                break

    if deployed_addr:
        env_path = Path(__file__).parent.parent / "app" / ".env.local"
        if env_path.exists():
            text = env_path.read_text()
            if "NEXT_PUBLIC_TRIVIA_ROYALE_ADDRESS" in text:
                import re
                text = re.sub(
                    r"NEXT_PUBLIC_TRIVIA_ROYALE_ADDRESS=.*",
                    f"NEXT_PUBLIC_TRIVIA_ROYALE_ADDRESS={deployed_addr}",
                    text,
                )
            else:
                text += f"\nNEXT_PUBLIC_TRIVIA_ROYALE_ADDRESS={deployed_addr}\n"
            env_path.write_text(text)
            print(f"Updated {env_path} with NEXT_PUBLIC_TRIVIA_ROYALE_ADDRESS={deployed_addr}")
        print(f"\nAlso update the fallback in app/src/lib/genlayer.ts:")
        print(f'  export const TRIVIA_ROYALE_ADDRESS = process.env.NEXT_PUBLIC_TRIVIA_ROYALE_ADDRESS ?? "{deployed_addr}";')
    else:
        print("Deploy output:")
        print(output)

    if result.returncode != 0:
        print("Exit code:", result.returncode, file=sys.stderr)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()

