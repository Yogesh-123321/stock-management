# TISPL inventory receiving platform

MERN-stack app implementing the material receiving flow:

Material arrives → check/register vendor → upload PO or proforma invoice →
enter stock (matches an existing part's stack, creates a new part number,
or registers a new part as an **alternate** of an existing one).

## What's new in this update

- **Single, consistent UI.** Ant Design and Chakra UI have been removed —
  the app was mixing three separate design systems (Tailwind/shadcn + antd +
  Chakra), each with its own reset and tokens, which is what was causing the
  clashing borders/inputs/focus rings. Everything is now one Tailwind +
  shadcn-style system: a dark sidebar shell, a steel-blue/copper palette,
  IBM Plex Sans/Mono + Inter for type, and part/registration numbers set as
  small monospace "chips" (mirrors how these codes are printed on the parts
  themselves).
- **Real vendor list seeded in.** All 13 completed vendor registrations from
  `TISPL_Vendor_registration_form-_PLC-_05_08_2026.docx` are extracted into
  `backend/src/data/vendors.seed.json` (company, GST/tax reg. no., bank
  details, signatory, etc.) and load in as **approved** vendors via
  `npm run seed:vendors`.
- **Real parts list seeded in.** All 361 unique parts from both tabs of
  `MasterPartDB.xlsx` (`Sheet1` + `Vats`, de-duplicated by TT unique part
  number) are in `backend/src/data/parts.seed.json` and load in via
  `npm run seed:parts`.
- **Vendor form fields expanded** to match the real registration form:
  nature of business, GST/tax registration no., bank details, principal
  customers, and signatory name/designation, in addition to the original
  fields. The Vendors page now has a "View" dialog showing the full profile
  per vendor.

## Stack

- **Backend**: Node.js, Express, MongoDB/Mongoose, Multer (file uploads)
- **Frontend**: React 18, Vite, React Router, Tailwind CSS + shadcn-style
  primitives (Button, Input, Textarea, Select, Table, Dialog, Card, Badge,
  Label, Tabs) — one design system throughout, no other UI libraries.

## Project structure

```
inventory-platform/
├── backend/
│   ├── server.js
│   ├── src/
│   │   ├── config/db.js
│   │   ├── models/          Vendor, Part, PurchaseOrder, StockEntry
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── middleware/      multer upload config, error handler
│   │   ├── data/            vendors.seed.json, parts.seed.json (bundled real data)
│   │   └── utils/
│   │       ├── generatePartNumber.js   auto TT-part-number generator
│   │       ├── seedVendors.js          loads data/vendors.seed.json
│   │       ├── seedParts.js            loads data/parts.seed.json
│   │       └── seedPartsFromExcel.js   imports any other MasterPartDB.xlsx by path
│   └── uploads/              po/, vendor-docs/ (gitignored contents)
└── frontend/
    └── src/
        ├── components/       Layout (sidebar shell), StepIndicator, ui/ (shadcn primitives)
        ├── pages/
        │   ├── Dashboard.jsx
        │   ├── ReceiveMaterial.jsx      the 3-step wizard shell
        │   ├── receive/
        │   │   ├── VendorStep.jsx       check / register vendor
        │   │   ├── POStep.jsx           upload PO / proforma invoice
        │   │   └── StockEntryStep.jsx   part matching + alternate-part flow
        │   ├── Vendors.jsx              list + approve/reject + detail dialog
        │   ├── Parts.jsx                master part database browser
        │   └── PurchaseOrders.jsx       uploaded documents list
        └── lib/               api.js (axios client), utils.js (cn helper)
```

## How the receiving flow maps to the code

1. **Vendor check** (`VendorStep.jsx` → `GET /api/vendors/check?name=`) —
   looks for an **approved** vendor with a matching name.
   - Found → continue to step 2.
   - Not found → the vendor registration form (matching the fields in the
     TISPL vendor registration `.docx`) is shown inline. Submitting creates
     the vendor with `status: "pending"`. A purchase head must approve it
     from the **Vendors** page before a PO can be uploaded against it.

2. **PO / proforma invoice upload** (`POStep.jsx` →
   `POST /api/purchase-orders`, multipart) — requires an approved vendor;
   the file is stored under `backend/uploads/po/`.

3. **Stock entry** (`StockEntryStep.jsx` → `GET /api/parts/lookup`,
   `POST /api/stock-entries`):
   - Enter the part number written on the material + quantity.
   - **Match found** → quantity is added directly to that part's
     `quantityInStock`.
   - **No match** → asks whether this is an **alternate part** of an
     existing part.
     - *No* → a brand-new `Part` is created; its TT unique part number is
       auto-generated from company code + category + part type + the next
       running serial number for that combination (mirrors the
       `TTAYFAN001` convention in the Master Database).
     - *Yes* → same as above, but the new part is linked via
       `alternateOf` / `alternateParts` back to the part you searched for.
   - Every entry is logged in `StockEntry` with `matchType` for audit/history.

## Setup

### 0. Prerequisites

- Node.js 18+ and npm
- A MongoDB instance — either install MongoDB Community Server locally, or
  create a free cluster at MongoDB Atlas and copy its connection string.

### 1. Backend

```bash
cd backend
cp .env.example .env      # edit MONGO_URI etc. if needed
npm install
```

### 2. Load the real vendor and parts data (recommended)

```bash
npm run seed:vendors      # loads the 13 vendors from the registration form, as "approved"
npm run seed:parts        # loads the 361 parts from the Master Database (Sheet1 + Vats)
# or both at once:
npm run seed
```

These read the bundled JSON in `backend/src/data/` — no file path needed.
Re-running is safe: existing companies/part numbers are left untouched.

If you later get an **updated** Master Database spreadsheet, import it
directly instead:

```bash
npm run seed:parts:xlsx -- /path/to/NewMasterPartDB.xlsx Sheet1
```

### 3. Start the backend

```bash
npm run dev                # http://localhost:5000
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev                # http://localhost:5173
```

The Vite dev server proxies `/api` and `/uploads` to `http://localhost:5000`
(see `vite.config.js`), so no CORS configuration is needed in development.
Open `http://localhost:5173` — you should see the Dashboard with the seeded
vendor/part counts.

### 5. Build for production

```bash
cd frontend && npm run build   # outputs frontend/dist
cd ../backend && npm start
```

Serve `frontend/dist` with any static host (or point Express at it) and set
`CLIENT_URL` in the backend `.env` to that origin.

## API summary

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/vendors` | List vendors (`?search=&status=`) |
| GET | `/api/vendors/check?name=` | Check if a name matches an approved vendor |
| POST | `/api/vendors` | Register a new vendor (multipart, `registrationDocument` optional) |
| PATCH | `/api/vendors/:id/approve` | Approve a pending vendor |
| PATCH | `/api/vendors/:id/reject` | Reject a pending vendor |
| GET | `/api/purchase-orders` | List uploaded PO/invoices |
| POST | `/api/purchase-orders` | Upload a PO/invoice (multipart, `document`) — vendor must be approved |
| PATCH | `/api/purchase-orders/:id/status` | Update status (`uploaded`/`stock_entry_in_progress`/`completed`) |
| GET | `/api/parts` | List/search parts |
| GET | `/api/parts/lookup?partNumber=` | Check whether a part number/mfr number already exists |
| POST | `/api/parts` | Create a part directly (auto part-number) |
| PATCH | `/api/parts/:id/stock` | Manually adjust a part's stock quantity |
| GET | `/api/stock-entries` | List stock entries (`?purchaseOrder=&vendor=`) |
| POST | `/api/stock-entries` | Record a receiving line — see `matchType` logic above |

## Not included (next steps)

- User authentication / role-based access (currently open — anyone can
  approve vendors or enter stock)
- Editing/deleting vendors, parts, or stock entries after creation
- Reporting/export (e.g. stock valuation, vendor performance)
- Automated tests
#   s t o c k - m a n a g e m e n t  
 