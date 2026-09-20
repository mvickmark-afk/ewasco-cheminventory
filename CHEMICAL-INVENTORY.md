# Chemical inventory workflow

The first feature increment adds server-side validation for a richer chemical inventory record.

Supported fields:

- `name` and optional CAS number
- `quantity`, `minimumQuantity`, and `unit`
- `location`, `supplier`, and `lotNumber`
- `hazardClass`, `expiry`, and `notes`

The API rejects negative quantities, invalid units, invalid CAS numbers, and invalid ISO dates. Existing role permissions remain enforced by the API.

Next UI increment: replace the generic JSON editor in `server/public/index.html` with a chemical form and inventory table using these fields, then add low-stock and expiry filters.
