-- ============================================================================
-- Fanation Club (fanation.club) — PostgreSQL schema
-- The ledger_events journal is the source of truth (Axiom A6); the other
-- tables are projections rebuilt from it. Constraints repeat the core rules
-- so the database refuses what the code refuses (A1, A5).
--
-- Not connected. The running process appends data/ledger.jsonl and does not
-- read DATABASE_URL. Creating this database on Vercel does not switch the
-- city over until a writer replays into these tables.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ledger_events (
    seq                 BIGINT PRIMARY KEY,
    at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source              VARCHAR(24) NOT NULL CHECK (source IN ('instagram_webhook', 'instagram_poll', 'simulated', 'market', 'payment', 'wallet')),
    kind                VARCHAR(32) NOT NULL CHECK (kind IN ('comment', 'listing_created', 'listing_cancelled', 'checkout_locked', 'payment_settled', 'token_transferred', 'lot_ad_set')),
    payload             JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS fandoms (
    fandom_handle       VARCHAR(30) PRIMARY KEY CHECK (fandom_handle ~ '^[a-z0-9._]{1,30}$'),
    display_name        VARCHAR(60) NOT NULL,
    category            VARCHAR(16) NOT NULL DEFAULT 'UNLISTED' CHECK (category IN ('ARTIST', 'CLUB', 'INFLUENCER', 'ATHLETE', 'UNLISTED')),
    neon_color_hex      CHAR(7) NOT NULL CHECK (neon_color_hex ~ '^#[0-9A-Fa-f]{6}$'),
    total_lands         INTEGER NOT NULL DEFAULT 0 CHECK (total_lands >= 0),
    engagement_points   BIGINT NOT NULL DEFAULT 0 CHECK (engagement_points >= 0)
);

-- A1: one mint per handle, forever. Ownership moves; the minter never does.
CREATE TABLE IF NOT EXISTS lands (
    minter_handle       VARCHAR(30) PRIMARY KEY CHECK (minter_handle ~ '^[a-z0-9._]{1,30}$'),
    owner_handle        VARCHAR(30) NOT NULL CHECK (owner_handle ~ '^[a-z0-9._]{1,30}$'),
    plot_index          INTEGER NOT NULL UNIQUE CHECK (plot_index >= 0),
    fandom_handle       VARCHAR(30) NOT NULL REFERENCES fandoms(fandom_handle),
    grid_q              INTEGER NOT NULL,
    grid_r              INTEGER NOT NULL,
    tier                VARCHAR(16) NOT NULL CHECK (tier IN ('TIER_1_EPIC', 'TIER_2_RARE', 'TIER_3_UNCOMMON', 'TIER_4_COMMON')),
    building_level      SMALLINT NOT NULL DEFAULT 1 CHECK (building_level BETWEEN 1 AND 10),
    source_comment_id   VARCHAR(128) NOT NULL UNIQUE,
    minted_at           TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_lands_grid_cell UNIQUE (grid_q, grid_r)
);
CREATE INDEX IF NOT EXISTS idx_lands_owner ON lands(owner_handle);
CREATE INDEX IF NOT EXISTS idx_lands_fandom ON lands(fandom_handle);

CREATE TABLE IF NOT EXISTS processed_comments (
    comment_id          VARCHAR(128) PRIMARY KEY,
    media_id            VARCHAR(128) NOT NULL,
    author_handle       VARCHAR(30) NOT NULL,
    outcome             VARCHAR(32) NOT NULL,
    received_at         TIMESTAMPTZ NOT NULL
);

-- One counted comment per fan per post.
CREATE TABLE IF NOT EXISTS counted_post_engagements (
    fan_handle          VARCHAR(30) NOT NULL,
    media_id            VARCHAR(128) NOT NULL,
    PRIMARY KEY (fan_handle, media_id)
);

CREATE TABLE IF NOT EXISTS token_balances (
    handle              VARCHAR(30) PRIMARY KEY,
    balance_micro       BIGINT NOT NULL CHECK (balance_micro >= 0)
);

CREATE TABLE IF NOT EXISTS market_listings (
    listing_id          VARCHAR(64) PRIMARY KEY,
    seller_handle       VARCHAR(30) NOT NULL,
    asset_type          VARCHAR(24) NOT NULL CHECK (asset_type IN ('LAND_PLOT', 'FANT_PACK')),
    plot_index          INTEGER REFERENCES lands(plot_index),
    token_amount_micro  BIGINT CHECK (token_amount_micro IS NULL OR token_amount_micro > 0),
    price_brl_cents     BIGINT NOT NULL CHECK (price_brl_cents > 0),
    price_usdt_micro    BIGINT NOT NULL CHECK (price_usdt_micro > 0),
    price_btc_sats      BIGINT NOT NULL CHECK (price_btc_sats > 0),
    status              VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED_ESCROW', 'SETTLED', 'CANCELLED')),
    lock_buyer_handle   VARCHAR(30),
    lock_method         VARCHAR(8) CHECK (lock_method IN ('PIX', 'USDT', 'USDC', 'BTC')),
    lock_expires_at     TIMESTAMPTZ,
    buyer_handle        VARCHAR(30),
    payment_method      VARCHAR(8) CHECK (payment_method IN ('PIX', 'USDT', 'USDC', 'BTC')),
    external_tx_ref     VARCHAR(128) UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL,
    settled_at          TIMESTAMPTZ,
    CHECK ((asset_type = 'LAND_PLOT') = (plot_index IS NOT NULL)),
    CHECK ((asset_type = 'FANT_PACK') = (token_amount_micro IS NOT NULL))
);
-- At most one active listing per plot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_listing_per_plot
    ON market_listings(plot_index) WHERE status IN ('OPEN', 'LOCKED_ESCROW');

CREATE TABLE IF NOT EXISTS media_renders (
    render_id           UUID PRIMARY KEY,
    total_lands         INTEGER NOT NULL,
    leader_fandom       VARCHAR(30),
    video_path          TEXT NOT NULL,
    caption             TEXT NOT NULL,
    instagram_media_id  VARCHAR(128),
    tiktok_publish_id   VARCHAR(128),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
