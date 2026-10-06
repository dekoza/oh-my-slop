"""PROTOTYPE - drive the subscription logic by hand: python3 prototype_subscription.py"""
import json

import subscription_machine as machine

state = machine.initial()
while True:
    print("\033[2J\033[H" + json.dumps(state, indent=2))
    print("  ".join(f"[{a}]" for a in machine.actions(state)) + "  [q] quit")
    try:
        choice = input("> ").strip()
    except EOFError:
        break
    if choice == "q":
        break
    if choice in machine.actions(state):
        state = machine.step(state, choice)
