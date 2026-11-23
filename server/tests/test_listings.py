"""Listings: role rules, ownership, location privacy, photos and favourites."""
import pytest

from app.services import images as image_store
from tests.conftest import auth_header, register

PLOT = {
    "title": "2 acre farmland near Lonavala",
    "description": "Fertile land with water access.",
    "price_inr": 4500000,
    "area_sqft": 87120,
    "latitude": 18.754321,
    "longitude": 73.405678,
    "address": "Survey No. 42, Kune village",
    "city": "Lonavala",
}


@pytest.fixture()
def fake_cloudinary(monkeypatch):
    """Never call the real Cloudinary in tests."""
    uploaded, deleted = [], []

    def upload(data, listing_id):
        uploaded.append(listing_id)
        return image_store.StoredImage(url=f"https://img.test/{len(uploaded)}.jpg", public_id=f"pid{len(uploaded)}")

    monkeypatch.setattr(image_store, "upload_listing_image", upload)
    monkeypatch.setattr(image_store, "delete_image", lambda pid: deleted.append(pid))
    return uploaded, deleted


def create(client, tokens, **overrides):
    res = client.post("/listings", json={**PLOT, **overrides}, headers=auth_header(tokens))
    assert res.status_code == 201, res.text
    return res.json()


def test_seller_and_broker_can_create_buyer_cannot(client):
    buyer = register(client, email="b@example.com", role="BUYER")
    seller = register(client, email="s@example.com", role="SELLER")
    broker = register(client, email="k@example.com", role="BROKER")
    assert client.post("/listings", json=PLOT, headers=auth_header(buyer)).status_code == 403
    listing = create(client, seller)
    assert listing["owner"]["name"] == "Test User" and listing["is_owner"] is True
    assert "email" not in listing["owner"]
    create(client, broker, title="Broker plot in Pune")


def test_validation(client):
    seller = register(client, role="SELLER")
    res = client.post("/listings", json={**PLOT, "price_inr": -5, "latitude": 123}, headers=auth_header(seller))
    assert res.status_code == 422


def test_only_owner_can_edit_or_delete(client):
    owner = register(client, email="o@example.com", role="SELLER")
    other = register(client, email="x@example.com", role="SELLER")
    listing = create(client, owner)
    url = f"/listings/{listing['id']}"
    assert client.patch(url, json={"price_inr": 1}, headers=auth_header(other)).status_code == 403
    assert client.delete(url, headers=auth_header(other)).status_code == 403
    res = client.patch(url, json={"price_inr": 4000000, "status": "SOLD"}, headers=auth_header(owner))
    assert res.status_code == 200 and res.json()["price_inr"] == 4000000 and res.json()["status"] == "SOLD"
    assert client.delete(url, headers=auth_header(owner)).status_code == 204
    assert client.get(url, headers=auth_header(owner)).status_code == 404


def test_feed_filters_and_hides_sold_and_drafts(client):
    seller = register(client, role="SELLER")
    buyer = register(client, email="b@example.com", role="BUYER")
    create(client, seller, title="Plot in Pune", city="Pune", price_inr=2000000)
    create(client, seller, title="Plot in Nashik", city="Nashik", price_inr=900000)
    sold = create(client, seller, title="Old sold plot")
    client.patch(f"/listings/{sold['id']}", json={"status": "SOLD"}, headers=auth_header(seller))

    feed = client.get("/listings", headers=auth_header(buyer)).json()
    assert feed["total"] == 2
    assert {i["title"] for i in feed["items"]} == {"Plot in Pune", "Plot in Nashik"}
    assert client.get("/listings", params={"city": "pune"}, headers=auth_header(buyer)).json()["total"] == 1
    assert client.get("/listings", params={"max_price": 1000000}, headers=auth_header(buyer)).json()["total"] == 1
    assert client.get("/listings", params={"q": "nashik"}, headers=auth_header(buyer)).json()["total"] == 1
    # The owner still sees everything in "mine".
    assert client.get("/listings", params={"mine": True}, headers=auth_header(seller)).json()["total"] == 3


def test_hidden_location_is_approximate_for_others_only(client):
    seller = register(client, role="SELLER")
    buyer = register(client, email="b@example.com", role="BUYER")
    listing = create(client, seller, hide_exact_location=True)

    as_buyer = client.get(f"/listings/{listing['id']}", headers=auth_header(buyer)).json()
    assert as_buyer["location_is_approximate"] is True
    assert as_buyer["latitude"] == 18.75 and as_buyer["longitude"] == 73.41
    assert as_buyer["address"] is None  # the street address would reveal the spot

    as_owner = client.get(f"/listings/{listing['id']}", headers=auth_header(seller)).json()
    assert as_owner["latitude"] == PLOT["latitude"] and as_owner["address"] == PLOT["address"]


def test_photo_upload_rules(client, fake_cloudinary):
    uploaded, deleted = fake_cloudinary
    owner = register(client, email="o@example.com", role="SELLER")
    other = register(client, email="x@example.com", role="BROKER")
    listing = create(client, owner)
    url = f"/listings/{listing['id']}/images"
    photo = {"file": ("plot.jpg", b"\xff\xd8fakejpeg", "image/jpeg")}

    assert client.post(url, files=photo, headers=auth_header(other)).status_code == 403
    assert client.post(url, files={"file": ("a.txt", b"hi", "text/plain")}, headers=auth_header(owner)).status_code == 415

    img = client.post(url, files=photo, headers=auth_header(owner))
    assert img.status_code == 201 and img.json()["url"].startswith("https://img.test/")
    detail = client.get(f"/listings/{listing['id']}", headers=auth_header(owner)).json()
    assert len(detail["images"]) == 1

    assert client.delete(f"{url}/{img.json()['id']}", headers=auth_header(owner)).status_code == 204
    assert deleted == ["pid1"]


def test_photo_limit(client, fake_cloudinary, monkeypatch):
    from app.routers import listings as listings_router

    monkeypatch.setattr(listings_router, "MAX_IMAGES", 2)
    owner = register(client, role="SELLER")
    listing = create(client, owner)
    url = f"/listings/{listing['id']}/images"
    photo = {"file": ("plot.jpg", b"\xff\xd8fake", "image/jpeg")}
    assert client.post(url, files=photo, headers=auth_header(owner)).status_code == 201
    assert client.post(url, files=photo, headers=auth_header(owner)).status_code == 201
    assert client.post(url, files=photo, headers=auth_header(owner)).status_code == 400


def test_favorites(client):
    seller = register(client, role="SELLER")
    buyer = register(client, email="b@example.com", role="BUYER")
    listing = create(client, seller)
    url = f"/listings/{listing['id']}/favorite"
    assert client.post(url, headers=auth_header(buyer)).status_code == 204
    assert client.post(url, headers=auth_header(buyer)).status_code == 204  # idempotent
    saved = client.get("/listings", params={"favorites": True}, headers=auth_header(buyer)).json()
    assert saved["total"] == 1 and saved["items"][0]["is_favorite"] is True
    assert client.delete(url, headers=auth_header(buyer)).status_code == 204
    assert client.get("/listings", params={"favorites": True}, headers=auth_header(buyer)).json()["total"] == 0
