# Chemical inventory workflow

This increment provides validation for the transitional chemical master record. It is not yet the authoritative inventory engine.

Validated fields include:

- chemical name and optional CAS number
- transitional quantity and minimum-quantity fields
- unit
- location
- supplier
- lot number
- hazard class
- expiry
- notes

The API rejects negative quantities, invalid units, invalid CAS numbers, and malformed ISO dates. Existing server-side role permissions remain enforced.

## Important domain boundary

The current `quantity` field is retained only for compatibility with the existing generic-record layer. It must not be extended into a stock ledger.

The authoritative inventory implementation will separate:

1. Chemical master — what the substance is.
2. Batch/lot — a physical received quantity.
3. Inventory transaction — every movement affecting stock.

The next implementation step is therefore receiving and batch creation followed by an immutable transaction ledger and server-side FIFO allocation.

See `PRODUCT-ARCHITECTURE.md` for the frozen product architecture and development sequence.
