"""Create (or reset) demo accounts and demo land listings so reviewers see a
populated app instantly.

Run from server/:  .venv\\Scripts\\python -m scripts.seed_demo

Accounts (password for all: demo1234):
    asha@example.com   Asha Buyer    BUYER
    ravi@example.com   Ravi Seller   SELLER
    meera@example.com  Meera Broker  BROKER

Safe to run repeatedly: demo users get their password/role reset, and demo
listings are matched by title so they're updated, not duplicated. Listings
start without photos; add some from the app to demo the upload flow.
"""
from sqlalchemy import select

from app.core.security import hash_password
from app.db import SessionLocal
from app.models import Listing, ListingStatus, Role, User

DEMO_PASSWORD = "demo1234"
DEMO_USERS = [
    ("Asha Buyer", "asha@example.com", Role.BUYER, "Looking for agricultural land near Pune."),
    ("Ravi Seller", "ravi@example.com", Role.SELLER, "Selling family plots in Maharashtra."),
    ("Meera Broker", "meera@example.com", Role.BROKER, "Licensed land broker, 10 years' experience."),
]

# (owner email, title, city, lat, lng, price ₹, area sqft, hide exact location, description)
DEMO_LISTINGS = [
    ("ravi@example.com", "2 acre farmland near Lonavala", "Lonavala", 18.7546, 73.4062, 4_500_000, 87_120, False,
     "Fertile red soil, borewell on site, 1 km from the highway. Ideal for a farmhouse or orchard."),
    ("ravi@example.com", "NA plot with road access, Hinjewadi", "Pune", 18.5913, 73.7389, 6_800_000, 2_400, False,
     "Non-agricultural plot in a gated layout near the IT park. Clear title, ready for construction."),
    ("ravi@example.com", "Riverside agricultural land, Nashik", "Nashik", 20.0059, 73.7910, 3_200_000, 130_680, True,
     "3 acres next to the Godavari, currently under grape cultivation. Exact location shared after a call."),
    ("meera@example.com", "Corner residential plot, Wakad", "Pune", 18.5994, 73.7625, 9_500_000, 3_000, False,
     "East-facing corner plot, 30 ft road on two sides. Schools and malls within 2 km."),
    ("meera@example.com", "Hill-view land for resort, Mahabaleshwar", "Mahabaleshwar", 17.9237, 73.6586, 15_000_000, 217_800, True,
     "5 acres with valley views, suited to an eco-resort. Broker-managed; site visits by appointment."),
    ("meera@example.com", "Industrial land near Chakan MIDC", "Chakan", 18.7606, 73.8636, 22_000_000, 43_560, False,
     "1 acre industrial-zoned land with power and water connections, 3 km from MIDC phase 2."),
    ("meera@example.com", "Weekend farm plot, Karjat", "Karjat", 18.9107, 73.3236, 2_100_000, 10_890, False,
     "Quarter-acre managed farm plot in a community with a caretaker, 2 hours from Mumbai."),
    ("ravi@example.com", "Coastal plot near Alibaug beach", "Alibaug", 18.6414, 72.8722, 12_500_000, 5_400, True,
     "10 minutes from the beach, coconut trees on the plot. Exact pin shared with serious buyers."),
]


def main() -> None:
    with SessionLocal() as db:
        users: dict[str, User] = {}
        for name, email, role, bio in DEMO_USERS:
            user = db.scalar(select(User).where(User.email == email))
            action = "reset"
            if user is None:
                user = User(email=email, name=name, role=role)
                db.add(user)
                action = "created"
            user.name, user.role, user.bio = name, role, bio
            user.password_hash = hash_password(DEMO_PASSWORD)
            users[email] = user
            print(f"{action:8} user     {email:20} {role.value}")
        db.flush()

        for owner_email, title, city, lat, lng, price, area, hide, desc in DEMO_LISTINGS:
            owner = users[owner_email]
            listing = db.scalar(select(Listing).where(Listing.title == title, Listing.owner_id == owner.id))
            action = "updated"
            if listing is None:
                listing = Listing(owner_id=owner.id, title=title)
                db.add(listing)
                action = "created"
            listing.city, listing.latitude, listing.longitude = city, lat, lng
            listing.price_inr, listing.area_sqft, listing.hide_exact_location = price, area, hide
            listing.description, listing.status = desc, ListingStatus.ACTIVE
            listing.address = f"{city}, Maharashtra"
            print(f"{action:8} listing  {title}")
        db.commit()
    print(f"\nPassword for all demo accounts: {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
