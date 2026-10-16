# Fanation Club — Domain Axioms (ADR-0001)

Every module, constraint, 3D coordinate and settlement in `fanation.club` derives from these axioms.

## A1 — One Mint, A Bank of Deeds; Reputation Is Earned, Never Sold
The comment's author (as reported by Meta) is the fan; the comment only has to name the idol: `@taylorswift`. The normalized handle of the **minter** is the immutable primary key of a home: **one mint per @, forever** — a second mint is impossible. Ownership is a bank, like Monopoly: the same @ may hold 1, 2, 5… deeds bought on the market, and may advertise on lots they currently hold (the ad lives on the title deed and dies when the deed is sold). The minter never changes. Reputation (XP) stays on the @ that earned it.

Two different values exist and never mix:
- **Reputation (XP)** belongs to the profile that earned it: +100 XP for moving in, +10 XP for each later counted comment (once per post). It cannot be listed, sold, bought or transferred; selling a home moves the home, not the XP.
- **$FANT** is the tradable balance (integer micro-units, 6 decimals); joining mints a pack under A11.

Tagging friends after joining pays +1 XP per new friend, once per friend ever and at most 20 new friends a day, so repeated or robotic tagging earns nothing.

A fan belongs to the district they moved into; their later XP also grows that fandom.

## A2 — Hostile Boundary
Every inbound byte is hostile until verified.
1. Meta webhooks: `X-Hub-Signature-256` (HMAC-SHA256 over the raw body) and the `hub.verify_token` handshake. Payment callbacks: HMAC over the raw body.
2. The fan's own @ and the official account are ignored inside the comment; if a fan tags friends too, a catalogued idol wins over an unknown handle; otherwise the first mention is the idol. Self-fandom, control/bidi characters, script payloads and character spam are rejected.
3. Meta sends no follower count, account age or commenter IP, so the only behavioural limits are per handle (5 comments / minute) and per post (one counted comment per fan). The SQL primary key is the final guard against duplicate mints.

## A3 — Unbounded Cities, Districts Around Idols
The grid is cut into blocks of 3×3 lots (16 m) separated by 14 m streets. Block row 0 and block column 0 are the two grand avenues; they cross at the Capital (a 15-lot disc that holds no properties) and split the plane into four quadrants that extend forever: Music City (artists), Stadium City (clubs, athletes), Creator City (influencers) and Community City (everyone uncatalogued). Every lot belongs to exactly one territory by geometry alone, so cities never grow into each other at any size.
- A catalogued idol founds a district on a landmark block at the next free point of its city's wide golden spiral (`θ = k · 137.50776°`, `r = 6 lots · √k`, snapped to block centres).
- Anyone else named before owning a home gets one lot on Community City's golden spiral.
- A fan's home is the next free lot of a solid disc around their idol's property, in exact order of distance (integer maths only, so every engine computes the same city). When other districts close the disc in, the neighbourhood continues at the free lot nearest to it, in the same city. Early fans therefore live closest; time becomes distance.
- A chunk index (taken lots per city per 24×24-lot chunk) finds the nearest room by skipping full chunks, so placement cost stays flat as the planet fills (`npm run growth:preview` proves overlap, territory and timing at 300k properties).

**The map reorganizes itself.** Ownership, the fan graph, XP and $FANT never change; positions do. At each layout epoch (`FANATION_LAYOUT_EPOCH_SECONDS` of comment time) the map is rebuilt from the fan tree: in each city the founding idols are placed biggest following first (the largest idols hold the centre and move towards it as they grow), then each idol's tree is laid out depth-first in arrival order, so a fan who has fans gets their whole neighbourhood built right next to them. Every following is one piece, nested at any depth, and the earliest fans stay closest. Between epochs new homes take the nearest free lot. The rebuild runs on the first comment of a new epoch, so it is part of the journal's replay: the same journal and epoch length always give the same map.

**World fabric stays off the road.** The two grand avenues stay open road forever (they are the middle track): no stadium, arena, hall or bridge is built on them. Each city's reserved plaza, inside the city, holds one ownerless venue — arena (Music), stadium (Stadium City), studio (Creators), hall (Community). The Capital plaza stays a plaza. Nothing there is minted or sold.

## A4 — The Same Rule for Everyone
Anyone who is named becomes an idol, and every property grows **in place** with its fans: Cottage (0), House (1), Townhouse (5), Villa (20), Tower (100), Skyscraper (1,000), Megatower (10,000). Height rises only inside the current style's band; crossing the next fan mark retires that silhouette and replaces it with a rarer one (Common → Uncommon → Rare → Epic → Legendary → Mythic → Apex). The same plot keeps the same variant inside a class, so the city never reshuffles. Catalogued idols own a Landmark block that follows the same tower ladder (never a cottage on a landmark). A fan who gains fans grows their own home and their own neighbourhood around it. Reputation (XP) is the finish: the higher the owner's level, the brighter the property.

## A5 — Integer-Only Money, Escrowed Trades
BRL cents, USDT/USDC micro-units, BTC satoshis and $FANT micro-units (6 decimals) are integers end to end. A checkout locks the listing for one buyer for 15 minutes; settlement requires the signed payment for that buyer and method, rejects underpayment and replayed references, takes a 2.5% fee on the price and records any excess as owed back to the buyer. Token packs are escrowed when listed.

## A6 — One Writer, Replayable State
All state changes are ledger events appended to the journal before the API answers. Booting replays the journal from the first line; a line that no longer applies halts the boot instead of serving a different city. Simulated (demo) fans and real fans never share a journal.

## A7 — One Global Ranking
Every fandom — artists, clubs, creators, athletes and uncatalogued communities — competes in a single global ranking ordered by the reputation its fans earned for it; there are no divisions. Categories only filter the view. Movement (positions gained or lost, XP change in %) is measured against the ranking one momentum window ago and derived from comment times, so a replay shows the same movement. Perks: #1 light beam, top 3 medal rings, top 10 full-brightness district neon.

## A9 — Partner Ads, Drawn by the Game
Partners book zeppelins (circling a city), billboards or banners. The map draws zeppelins only: standing billboards and towed banners covered the houses, so they are not placed. A creative is text and colours only (headline, tagline, the partner's real @, two hex colours), drawn by the game itself, so nothing foreign is ever loaded into the scene; it always prints `@partner · Sponsored`. Input is validated like comments (no control, bidi or markup characters, strict lengths). Quotes are integer BRL cents from the rate card; every request waits for review behind `FANATION_ADMIN_TOKEN`, and payment is taken after approval through the regular rails. Unsold slots show Fanation's own "advertise here" creative.

## A10 — Connect: Prove Your @ Where It Lives
A profile is controlled only by whoever proves the Instagram @: the site issues a one-time code (`FAN-XXXXXX`, 15 minutes, single use) bound to that @, and it counts only when Meta delivers a comment containing it **authored by that @**. The browser then gets a session (HttpOnly, SameSite=Lax, Secure over HTTPS; only SHA-256 digests are stored). Every state change (listing, cancelling, offers, $FANT transfers, checkout, lot ads) needs that session plus the app's `X-Fanation-Client` header, and acts only as the session's @ — a buyer or seller is never a name typed into a form.

## A11 — $FANT: Capped, Earned, Balanced
Hard cap 100,000,000 $FANT. 60% Fan Mint: one pack per new member, 1,000 $FANT for the first 3,000 members, then each era doubles in length and halves the pack (20 eras; after that, the home only); 10% of each pack goes to the idol the member named. 15% Seasons: when a season ends (`FANATION_SEASON_SECONDS` of comment time), 1% of what is left in the bucket is paid in proportion to the XP earned in that season — 70% to fans by their own XP, 30% to idols by the XP their fans earned for them — with no handle above 2%. 10% Liquidity, 10% Treasury (48-month vesting, 12-month cliff) and 5% Ecosystem stay locked and are never emitted by the game. Every emission is a ledger effect of a journaled comment, so replaying the journal reproduces every balance.

## A8 — Clarity, 8pt Grid
UI spacing comes only from `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128 px`, touch targets ≥ 44 px, dark frosted glass and a single action blue, so the neon city carries the colour.
