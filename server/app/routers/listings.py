"""Land listings: browse (everyone), create/edit/delete (sellers and brokers, own listings only).

Privacy: when a seller sets `hide_exact_location`, everyone except the owner
gets coordinates rounded to ~1 km (2 decimal places). The exact point never
leaves the server for them, so it can't be recovered from the app.
"""
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import get_current_user, require_role
from app.db import get_db
from app.models import Favorite, Listing, ListingImage, ListingStatus, Role, User
from app.schemas import ListingCreate, ListingImageOut, ListingOut, ListingPage, ListingUpdate, UserPublic
from app.services import images as image_store

router = APIRouter(prefix="/listings", tags=["listings"])

MAX_IMAGES = 8
APPROX_DECIMALS = 2  # ~1.1 km at the equator


def _to_out(listing: Listing, viewer: User, favorite_ids: set[uuid.UUID]) -> ListingOut:
    is_owner = listing.owner_id == viewer.id
    approximate = listing.hide_exact_location and not is_owner
    lat, lng = listing.latitude, listing.longitude
    if approximate:
        lat, lng = round(lat, APPROX_DECIMALS), round(lng, APPROX_DECIMALS)
    return ListingOut(
        id=listing.id,
        title=listing.title,
        description=listing.description,
        price_inr=listing.price_inr,
        area_sqft=listing.area_sqft,
        latitude=lat,
        longitude=lng,
        # The street address would give the exact spot away, so hide it too.
        address=None if approximate else listing.address,
        city=listing.city,
        hide_exact_location=listing.hide_exact_location,
        status=listing.status,
        owner=UserPublic.model_validate(listing.owner),
        images=[ListingImageOut.model_validate(i) for i in listing.images],
        is_owner=is_owner,
        is_favorite=listing.id in favorite_ids,
        location_is_approximate=approximate,
        created_at=listing.created_at,
        updated_at=listing.updated_at,
    )


def _favorite_ids(db: Session, user: User, listing_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not listing_ids:
        return set()
    return set(
        db.scalars(select(Favorite.listing_id).where(Favorite.user_id == user.id, Favorite.listing_id.in_(listing_ids)))
    )


def _load(db: Session, listing_id: uuid.UUID) -> Listing:
    listing = db.scalar(
        select(Listing)
        .where(Listing.id == listing_id)
        .options(selectinload(Listing.images), selectinload(Listing.owner))
    )
    if listing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    return listing


def _load_own(db: Session, listing_id: uuid.UUID, user: User) -> Listing:
    listing = _load(db, listing_id)
    if listing.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only change your own listings")
    return listing


@router.get("", response_model=ListingPage)
def browse_listings(
    q: str | None = Query(None, max_length=80, description="Search title, description, city"),
    city: str | None = Query(None, max_length=80),
    min_price: int | None = Query(None, ge=0),
    max_price: int | None = Query(None, ge=0),
    mine: bool = Query(False, description="Only my own listings (any status)"),
    favorites: bool = Query(False, description="Only listings I've saved"),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ListingPage:
    stmt = select(Listing)
    if mine:
        stmt = stmt.where(Listing.owner_id == user.id)
    else:
        # The public feed shows active listings; drafts and sold ones only in "mine".
        stmt = stmt.where(Listing.status == ListingStatus.ACTIVE)
    if favorites:
        stmt = stmt.join(Favorite, Favorite.listing_id == Listing.id).where(Favorite.user_id == user.id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Listing.title.ilike(like), Listing.description.ilike(like), Listing.city.ilike(like)))
    if city:
        stmt = stmt.where(Listing.city.ilike(city.strip()))
    if min_price is not None:
        stmt = stmt.where(Listing.price_inr >= min_price)
    if max_price is not None:
        stmt = stmt.where(Listing.price_inr <= max_price)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.options(selectinload(Listing.images), selectinload(Listing.owner))
        .order_by(Listing.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    favs = _favorite_ids(db, user, [r.id for r in rows])
    return ListingPage(items=[_to_out(r, user, favs) for r in rows], total=total, limit=limit, offset=offset)


@router.get("/{listing_id}", response_model=ListingOut)
def get_listing(listing_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ListingOut:
    listing = _load(db, listing_id)
    if listing.status == ListingStatus.DRAFT and listing.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    return _to_out(listing, user, _favorite_ids(db, user, [listing.id]))


@router.post("", response_model=ListingOut, status_code=status.HTTP_201_CREATED)
def create_listing(
    body: ListingCreate,
    user: User = Depends(require_role(Role.SELLER, Role.BROKER)),
    db: Session = Depends(get_db),
) -> ListingOut:
    listing = Listing(owner_id=user.id, **body.model_dump())
    db.add(listing)
    db.commit()
    return _to_out(_load(db, listing.id), user, set())


@router.patch("/{listing_id}", response_model=ListingOut)
def update_listing(
    listing_id: uuid.UUID,
    body: ListingUpdate,
    user: User = Depends(require_role(Role.SELLER, Role.BROKER)),
    db: Session = Depends(get_db),
) -> ListingOut:
    listing = _load_own(db, listing_id, user)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(listing, field, value)
    db.commit()
    return _to_out(_load(db, listing.id), user, _favorite_ids(db, user, [listing.id]))


@router.delete("/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_listing(
    listing_id: uuid.UUID,
    user: User = Depends(require_role(Role.SELLER, Role.BROKER)),
    db: Session = Depends(get_db),
) -> Response:
    listing = _load_own(db, listing_id, user)
    public_ids = [i.public_id for i in listing.images if i.public_id]
    db.delete(listing)
    db.commit()
    for pid in public_ids:
        image_store.delete_image(pid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- photos ----------

@router.post("/{listing_id}/images", response_model=ListingImageOut, status_code=status.HTTP_201_CREATED)
async def upload_image(
    listing_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(require_role(Role.SELLER, Role.BROKER)),
    db: Session = Depends(get_db),
) -> ListingImage:
    listing = _load_own(db, listing_id, user)
    if len(listing.images) >= MAX_IMAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"A listing can have at most {MAX_IMAGES} photos")
    if file.content_type not in image_store.ALLOWED_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a JPEG, PNG, WebP or HEIC photo")
    data = await file.read(image_store.MAX_BYTES + 1)
    if len(data) > image_store.MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Photo is larger than 8 MB")
    try:
        stored = image_store.upload_listing_image(data, str(listing.id))
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Photo upload failed, please try again")
    image = ListingImage(listing_id=listing.id, url=stored.url, public_id=stored.public_id, position=len(listing.images))
    db.add(image)
    db.commit()
    db.refresh(image)
    return image


@router.delete("/{listing_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_listing_image(
    listing_id: uuid.UUID,
    image_id: uuid.UUID,
    user: User = Depends(require_role(Role.SELLER, Role.BROKER)),
    db: Session = Depends(get_db),
) -> Response:
    listing = _load_own(db, listing_id, user)
    image = next((i for i in listing.images if i.id == image_id), None)
    if image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    public_id = image.public_id
    db.delete(image)
    db.commit()
    if public_id:
        image_store.delete_image(public_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- favourites (any role) ----------

@router.post("/{listing_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
def add_favorite(listing_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    _load(db, listing_id)
    if db.get(Favorite, (user.id, listing_id)) is None:
        db.add(Favorite(user_id=user.id, listing_id=listing_id))
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{listing_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
def remove_favorite(listing_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    fav = db.get(Favorite, (user.id, listing_id))
    if fav is not None:
        db.delete(fav)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
