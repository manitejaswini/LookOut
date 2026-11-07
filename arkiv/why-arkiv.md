# Why Arkiv

## If this data sat in Postgres instead, what could people no longer do?

Lookout's value is that nobody has to trust the Lookout team's database. Moving the records into Postgres removes these:

1. **Verify the table you are served.** The root hash of the lookup table is a `snapshot` entity written by a registered indexer. A client checks the table the PIR servers serve against it, so a lying server is detected. With Postgres, the root would be whatever the operator says.
2. **Rebuild the same table independently.** Reports, verdicts, attestations, rulings and reputation are public entities, and the trusted-writer rules are a public list of wallets. A second indexer can read Arkiv, apply the same rules and get the same root. A private database cannot be audited like that.
3. **Prove who said what.** Every entity carries `$creator`. A `block` flag is only counted if a registered source wallet wrote it, and anyone can check that. In Postgres, "who wrote this row" is the operator's claim.
4. **Let flags age out without anyone deleting them.** Each entity has an expiry in blocks. A feed that stops refreshing its 6-hour verdict loses the flag by itself. A report expires in 24 hours. In Postgres, a stale accusation lives until someone remembers to delete it, and the operator can quietly keep or drop rows.
5. **Let an owner dispute without asking permission.** An address owner writes an `attestation` signed with that address. Everyone's client sees it. No ticket, no admin.
6. **Show a public reason for every ruling.** The operator's `ruling` entities have public reasons and a public creator. A wrongly decided case is visible, not hidden in a table.
7. **Link the user to the record.** The Pay page links every verdict to `https://rabdi.explorer.arkiv.network/entity/<id>`. The user can see the evidence themselves.

## What can people do with this on Arkiv that they cannot with the original source?

There is no single original source: Lookout's data is created natively. The comparison is with the alternatives people use today.

- **A wallet vendor's blocklist** is closed, unauditable and cannot be appealed.
- **Open scam-report sites** accept free reports and have no corroboration or weighting.

On Arkiv, with Lookout:

- a **filter by trusted writer** (`$creator`) turns the same open store into a curated list, and different indexers can choose different trust lists over the same data;
- a **deposit-backed report** (escrow on Sepolia, mirrored as a `stake` entity) is visible next to the verdicts that confirmed it;
- **reputation checkpoints** (`reputation` entities) are published, so a reporter's weight is reproducible by anyone.

## What we do not claim

- Arkiv does not give privacy. Attributes are public, so we store only hashes, enums and numbers, and the private lookup is done off Arkiv with PIR.
- Arkiv alone does not prove "unique human". World ID is checked on our server (see the README trust limits).
- The records today are test and demo data.
