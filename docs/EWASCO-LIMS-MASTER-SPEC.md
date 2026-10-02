# EWASCO LIMS — Master Product, Architecture & Delivery Specification

Version: 1.0  
Status: Approved product direction / implementation baseline  
Repository: `mvickmark-afk/ewasco-cheminventory`

## 1. Product objective

EWASCO LIMS is the laboratory system of record for water, wastewater, environmental and chemical-laboratory operations.

The target system connects:

**Plan → Collect → Receive → Chain of Custody → Prepare → Analyse → QC → Review → Approve → Report → Archive → Trend → Improve**

The existing Chemical Inventory modules remain operational while the LIMS migration is completed. They are not to be deleted or replaced with mock screens.

## 2. Architecture principles

1. PostgreSQL is the system of record.
2. Express/Node.js remains the application/API layer.
3. Vanilla JavaScript remains the current frontend until a deliberate frontend migration is approved.
4. Every organization-scoped record must be tenant-isolated by `organization_id`.
5. Server-side authorization is authoritative; UI visibility is only a convenience.
6. Every material workflow change is auditable.
7. Approved analytical results are immutable/locked.
8. Workflow transitions are explicit and server enforced.
9. Configuration data (methods, specifications, limits, units, schedules) must not be hard-coded into business logic.
10. Uploaded documents are treated as untrusted input and validated by extension, MIME identity and content signature where applicable.
11. Long-lived records require versioning and traceability.
12. No feature is considered complete until its validation, authorization, audit and failure paths are tested.

## 3. Current core LIMS

### Dashboard
- Sample counts by lifecycle state
- Test/worklist counts
- Result review/approval status
- Specification failures
- Role-aware operational visibility

### Sample Management
- Sample registration
- Sampling-point association
- Matrix/sample type
- Collection and receipt timestamps
- Test assignment
- Priority and due dates
- Sample lifecycle

### Analytical Worklist
- Planned/assigned/in-progress work
- Analyst assignment
- Claiming work
- Due-date visibility

### Tests & Methods
- Method code/name
- Analyte
- Matrix
- Result type
- Default unit
- Method reference/version
- Active/inactive control

### Specifications
- Parameter
- Operator
- Limits
- Units
- Source reference
- Active/inactive control
- Automatic PASS/FAIL evaluation for numeric results

### Result workflow
- Result entry
- Raw-value retention
- Numeric/text result types
- Instrument reference
- Independent review
- Re-authenticated approval
- Separation of duties
- Approved-result lock

### Security
- Administrator
- Laboratory Manager
- Analyst/Chemist
- Storekeeper
- Sessions, CSRF protection, rate limiting, password policy and audit trail

## 4. Water and environmental laboratory expansion

These capabilities form the target EWASCO water/environmental LIMS layer.

### 4.1 Sampling programmes
- Routine sampling schedules
- Monthly/quarterly/annual/event-driven schedules
- Sampling-point-specific test requirements
- Due-date alerts
- Missed/late sampling
- Resampling/repeat sampling
- Complaint/incident samples
- Seasonal programmes
- Sampling rounds/routes

### 4.2 Field collection
- Mobile-friendly field capture
- Collector identity
- GPS coordinates
- Collection timestamp
- Weather/site conditions
- Field observations
- Field measurements
- Photo/evidence attachment
- Barcode/QR sample identification
- Offline queue and later synchronization
- Electronic chain of custody

### 4.3 Chain of custody
- COC number
- Sample/container identity
- Collector
- Custody transfers
- Transport details
- Receipt condition
- Temperature/condition checks
- Missing/broken/compromised sample flags
- Electronic signatures
- Complete custody history

### 4.4 Water treatment laboratory
- Raw water
- Process water
- Treated water
- Distribution water
- Storage/tank points
- Routine microbiology
- Physicochemical testing
- Disinfection monitoring
- Treatment-stage sampling
- Plant/sample-point trend analysis

### 4.5 Wastewater
- Influent
- Effluent
- Process stages
- Discharge/outfall points
- Grab/composite samples
- Flow data
- Loading calculations
- Removal efficiency
- Permit-limit configuration
- Exceedance management
- Compliance reporting

### 4.6 Environmental media
Support a configurable matrix model for:
- Water
- Wastewater
- Soil
- Sediment
- Sludge
- Air
- Waste/residuals

The same sample/test/result engine should support multiple matrices rather than creating separate systems.

## 5. Laboratory operations

### Sample preparation
- Preparation instructions
- Dilution factors
- Digestion/extraction
- Aliquots
- Reagent/lot consumption
- Preparation timestamps
- Analyst attribution
- Parent/child sample relationships

### Batch management
- Analytical batch
- Preparation batch
- QC batch
- Calibration batch
- Sample-to-batch membership
- Batch acceptance/rejection
- Batch-level review

### QA/QC
- Blanks
- Duplicates
- Matrix spikes
- Laboratory control samples
- Calibration checks
- Reference materials
- Recovery limits
- Precision limits
- Control charts
- Out-of-control rules
- QC exception workflow

### Hold-time management
- Method-specific hold times
- Clock starts at collection
- Warning thresholds
- Expired/late analysis flag
- Reason/exception record
- Hold-time reporting

## 6. Instruments and integration

Target architecture:

**Instrument → Adapter/Import → Validation → Raw Data → Result Candidate → Review → Approved Result**

Features:
- Instrument registry
- Manufacturer/model/serial number
- Location
- Calibration status
- Maintenance status
- Analyst authorization
- Interface configuration
- Worklist export
- Result import
- File provenance
- Duplicate/import detection
- Raw file retention
- Interface error queue

Future interfaces may include:
- pH meters
- balances
- turbidity meters
- conductivity meters
- spectrophotometers
- titrators
- IC
- ICP/ICP-MS
- GC/GC-MS
- LC/LC-MS
- microbiology readers
- field sondes

Instrument integrations must be added as adapters rather than embedded directly into result routes.

## 7. Calculations engine

A controlled calculation engine should replace spreadsheet-only calculations.

Required capabilities:
- Unit conversion
- Dilution
- Concentration
- Preparation factors
- Dry-weight basis
- Moisture correction
- Recovery
- BOD
- COD
- TSS/TDS
- alkalinity
- hardness
- chloride
- fluoride
- nitrate/nitrite
- ammonia
- phosphate
- metals
- microbiological calculations
- loading
- removal efficiency
- running averages
- configurable water-quality indices

Each calculation must store:
- Formula/version
- Inputs
- Units
- Intermediate values where required
- Output
- Timestamp
- User/system identity
- Calculation version

Never silently replace an old calculation version.

## 8. Method and specification governance

Methods need lifecycle states:

**Draft → Technical Review → Approved → Active → Superseded → Retired**

Specifications need:
- Regulatory source
- Effective date
- Expiry/review date
- Matrix
- Parameter
- Unit
- Limit
- Applicability
- Version
- Approval record

A result must be evaluated against the specification version applicable to the sample/test, not whichever limit happens to be current today.

## 9. SDS / Chemical Safety

The existing SDS workflow is the foundation.

Target:
- DOCX/PDF/XLSX upload
- 10 MB limit
- deterministic metadata extraction
- controlled human review
- CAS validation
- revision-date validation
- document version history
- SHA-256 provenance
- manufacturer/product linkage
- chemical inventory linkage
- expiry/review reminders
- approval status
- replacement history
- audit trail

Never guess ambiguous metadata.

## 10. Chemical inventory integration

Chemical Inventory should become a true LIMS inventory service.

Target relationships:

**Chemical → SDS → Supplier → Lot/Batch → Storage Location → Reagent → Preparation → Consumption → Waste**

Capabilities:
- CAS
- hazard classification
- SDS status
- manufacturer
- supplier
- lot number
- received date
- expiry
- quantity
- unit
- storage location
- minimum stock
- reorder point
- restricted/controlled flag
- opened date
- responsible user
- disposal/waste link

## 11. Reagent management

Target lifecycle:

**Reagent definition → Preparation → QC/verification → Release → Use → Expiry → Disposal**

Track:
- formula
- concentration
- lot
- preparation date
- expiry
- preparer
- verifier
- source chemicals
- quantities consumed
- preparation worksheet
- verification result
- status

## 12. Equipment and calibration

Equipment record:
- asset number
- type
- manufacturer
- model
- serial
- location
- responsible department
- status

Calibration:
- calibration schedule
- standard/reference used
- calibration points
- acceptance criteria
- certificate attachment
- due date
- overdue alert
- out-of-tolerance event
- impact assessment
- corrective action

Equipment should be automatically blocked from applicable testing when calibration status is invalid, unless an authorized exception is recorded.

## 13. Quality Management System expansion

EWASCO LIMS should progressively include QMS functions:

- SOP/document control
- Training and competency
- Deviations
- Nonconformances
- CAPA
- Complaints
- Internal audits
- External audits
- Corrective actions
- Preventive actions
- Risk register
- Change control
- Management review
- Supplier qualification

The QMS layer should integrate with LIMS records rather than becoming an unrelated document repository.

## 14. Reporting

Required reports:
- Certificate of Analysis (CoA)
- Sample report
- Test report
- Batch report
- Sampling schedule
- Missed sampling
- Exceedance
- QC summary
- Analyst workload
- Turnaround time
- Hold-time compliance
- Instrument utilization
- Calibration due/overdue
- Chemical stock
- SDS status
- Waste generation
- Water-treatment laboratory summary
- Management dashboard

Reports must be generated from approved system records.

## 15. Client/management portal

Future external-facing capabilities:
- Sample submission
- Sample status
- COC
- Result availability
- CoA download
- Secure document exchange
- Notifications
- Client/project management
- Controlled API access

External users must never receive internal drafts or unapproved results.

## 16. Analytics

Target dashboards:
- Samples by location
- Parameter trends
- Exceedances
- Seasonal trends
- Analyst workload
- Turnaround time
- Pending review
- QC performance
- Instrument utilization
- Chemical consumption
- Chemical expiry
- Waste trends
- Sampling compliance
- Water-quality trends

Advanced analytics can later add anomaly detection, forecasting and trend alerts, but analytical conclusions must remain reviewable and traceable.

## 17. Search and data retrieval

Enterprise search should eventually support:
- sample number
- COC number
- chemical
- CAS
- SDS
- batch
- reagent
- instrument
- sampling point
- analyte
- method
- result
- client/project

Filters:
- date
- status
- matrix
- analyst
- location
- method
- parameter
- specification
- pass/fail

## 18. Barcodes and identifiers

Use machine-readable identifiers for:
- samples
- containers
- batches
- reagents
- chemicals
- equipment
- SDS documents
- COC documents

The identifier service should guarantee uniqueness and preserve historical identifiers.

## 19. Notifications

Notification engine:
- overdue samples
- approaching hold time
- overdue calibration
- SDS revision due
- chemical expiry
- low stock
- failed QC
- failed specification
- pending review
- pending approval
- missed sampling
- CAPA due date

Notifications must be persisted as events so that critical alerts are auditable.

## 20. Security and data integrity

Target controls:
- RBAC
- least privilege
- separation of duties
- MFA
- session revocation
- password history
- account lockout
- audit trail
- electronic signatures
- immutable approved results
- tenant isolation
- encryption in transit
- encrypted backup strategy
- restore testing
- file hashing
- upload content validation
- rate limiting
- CSRF protection
- secure headers
- dependency vulnerability management

## 21. Data architecture

Core domains:

`organizations`
`users`
`sessions`
`audit_log`

LIMS:

`sampling_points`
`sampling_schedules`
`samples`
`sample_containers`
`chain_of_custody`
`sample_tests`
`test_methods`
`method_versions`
`specifications`
`specification_versions`
`results`
`result_versions`
`analytical_batches`
`qc_results`
`calculations`

Laboratory operations:

`instruments`
`instrument_interfaces`
`instrument_files`
`equipment`
`calibrations`
`reagents`
`reagent_preparations`

Inventory:

`chemicals`
`chemical_lots`
`suppliers`
`procurement`
`consumption`
`waste`
`sds`
`sds_versions`

Quality:

`documents`
`document_versions`
`training`
`competency`
`deviations`
`capa`
`complaints`
`audits`
`change_controls`

Reporting/integration:

`reports`
`report_runs`
`notifications`
`integration_endpoints`
`integration_events`

New tables should be introduced through versioned migrations and must preserve existing records.

## 22. UI design direction

The navigation should evolve from the current two-level LIMS/LEGACY structure into these functional domains:

### LIMS
- Dashboard
- Samples
- Analytical Worklist
- Sampling & Field
- Chain of Custody
- Tests & Methods
- Specifications
- Results & Review
- Reports / CoA

### QUALITY
- QC & Control Charts
- Deviations
- CAPA
- Audits
- Training & Competency
- Document Control

### LABORATORY
- Instruments
- Equipment
- Calibrations
- Reagents
- Calculations

### CHEMICALS & ENVIRONMENT
- Chemical Inventory
- SDS / MSDS
- Procurement
- Consumption
- Waste
- Water Treatment

### MANAGEMENT
- Analytics
- Compliance
- Suppliers
- Client Portal
- Integrations
- Settings
- Security & Users
- Audit Trail

Only modules with implemented server/API support should be exposed as active navigation items. Future modules can be represented in product documentation until their APIs and authorization are implemented.

## 23. Competitive capability benchmark

The product direction deliberately incorporates common capabilities documented by established water/environmental LIMS platforms: sampling schedules and point registries, electronic chain of custody, field/mobile capture, regulatory limit checking, trend/control-chart analysis, wastewater loading/compliance workflows, instrument interfaces, batch QC, hold-time management, reporting, portals and configurable workflows. LabWare documents these capabilities for water/environmental laboratories, while LABWORKS documents scheduling, mobile collection, COC, GPS/GIS, compliance, instrument management, reporting and environmental/water workflows. citeturn0search0turn0search1

These are capability references, not instructions to copy proprietary implementation, interfaces or branding.

## 24. Delivery roadmap

### Phase 0 — Stabilization
- SDS reliability
- session-token uniqueness
- repository hygiene
- CI verification
- deployment gating
- transaction safety
- dependency audit
- backup verification

### Phase 1 — LIMS foundation
- sample login
- sampling points
- methods
- specifications
- worklist
- results
- review/approval
- CoA/report generation
- advanced audit

### Phase 2 — Water operations
- schedules
- field collection
- COC
- route planning
- GPS
- water-treatment workflows
- wastewater workflows
- compliance calendars

### Phase 3 — Laboratory quality
- QC batches
- control charts
- hold times
- calculations engine
- method/specification versioning
- equipment/calibration integration

### Phase 4 — Digital laboratory
- instrument interfaces
- barcode/QR
- mobile/offline field application
- raw-data management
- electronic signatures
- client portal

### Phase 5 — QMS and enterprise
- document control
- training
- CAPA
- deviations
- audits
- change control
- multi-site management
- enterprise integrations

### Phase 6 — Advanced intelligence
- trend detection
- anomaly alerts
- forecasting
- workload optimization
- predictive maintenance
- automated data-quality checks

AI/automation must remain advisory unless a validated deterministic workflow explicitly authorizes an automated action.

## 25. Definition of done for every new module

A module is production-ready only when all are present:

- UI
- API
- database migration
- server-side validation
- RBAC
- tenant isolation
- audit events
- workflow/state rules
- error handling
- optimistic concurrency where applicable
- tests
- build verification
- documentation
- backup/restore consideration
- deployment verification

## 26. Non-negotiable quality gates

Before merging:
1. Syntax verification
2. Unit tests
3. API/contract tests
4. Security checks
5. Migration verification
6. Frontend asset verification
7. No secrets
8. No untracked runtime artifacts
9. Reviewable diff
10. CI success

Before production:
1. CI success
2. Railway deployment success
3. `/healthz`
4. `/readyz`
5. login
6. role authorization
7. representative LIMS workflow
8. audit trail
9. backup/restore readiness
10. smoke test of critical uploads/integrations

## 27. Product outcome

The target EWASCO LIMS is not simply a replacement for the current Chemical Inventory application.

It is a unified laboratory operating platform connecting:

**Water treatment + environmental sampling + laboratory analysis + chemical inventory + equipment + quality management + compliance + reporting**

while retaining the current PostgreSQL/Node/Express architecture and progressively replacing legacy screens with controlled, API-backed LIMS workflows.
