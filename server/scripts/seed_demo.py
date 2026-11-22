"""Create (or reset) the demo accounts, one per role, so reviewers can log in instantly.

Run from server/:  .venv\\Scripts\\python -m scripts.seed_demo

Accounts (password for all: demo1234):
    asha@example.com   Asha Buyer    BUYER
    ravi@example.com   Ravi Seller   SELLER
    meera@example.com  Meera Broker  BROKER

Safe to run repeatedly: existing demo users get their password and role reset.
"""
from sqlalchemy import select

from app.core.security import hash_password
from app.db import SessionLocal
from app.models import Role, User

DEMO_PASSWORD = "demo1234"
DEMO_USERS = [
    ("Asha Buyer", "asha@example.com", Role.BUYER, "Looking for agricultural land near Pune."),
    ("Ravi Seller", "ravi@example.com", Role.SELLER, "Selling family plots in Maharashtra."),
    ("Meera Broker", "meera@example.com", Role.BROKER, "Licensed land broker, 10 years' experience."),
]


def main() -> None:
    with SessionLocal() as db:
        for name, email, role, bio in DEMO_USERS:
            user = db.scalar(select(User).where(User.email == email))
            if user is None:
                user = User(email=email, name=name, role=role)
                db.add(user)
                action = "created"
            else:
                action = "reset"
            user.name, user.role, user.bio = name, role, bio
            user.password_hash = hash_password(DEMO_PASSWORD)
            print(f"{action:8} {email:20} {role.value}")
        db.commit()
    print(f"\nPassword for all demo accounts: {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
