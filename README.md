# Attendo -- IoT Fingerprint Attendance System

```
attendo-project/
  database.sql                         <- fresh-install schema
  migration_section_to_subject.sql      <- run if upgrading from the pre-section version
  migration_bulk_import.sql              <- run if upgrading to enable Excel import / Register button
  backend/
  frontend/
  firmware/
```

## Applying migrations to an existing database

If you already had this running before the section change:
```powershell
docker cp migration_section_to_subject.sql attendo-postgres:/m1.sql
docker exec -it attendo-postgres psql -U postgres -d attendo -f /m1.sql
```

Then, for this Excel-import feature (makes fingerprint_id nullable):
```powershell
docker cp migration_bulk_import.sql attendo-postgres:/m2.sql
docker exec -it attendo-postgres psql -U postgres -d attendo -f /m2.sql
```

(Brand new setup? Just run `database.sql` -- it already has both changes baked in.)

## 1. Backend
```
cd backend
npm install
copy .env.example .env
npm run dev
```

## 2. Frontend
```
cd frontend
npm install
npm run dev
```
(`npm install` now also pulls in the `xlsx` package used to parse the Excel upload.)

## New: bulk import via Excel

In "Add Student," there's now a **Manual / Import Excel** toggle.

- **Import Excel**: upload an `.xlsx` or `.xls` file with a column containing "Name" and one containing "ID" (header matching is flexible -- e.g. "Full Name" or "Student ID" both work, as long as one header contains "name" and another contains "id"). Every valid row is saved to the roster immediately, but without a fingerprint yet.
- On the roster table, any student without a fingerprint shows a **Register** pill instead of a slot number. Clicking it pops the same scan panel as manual entry -- but skips straight to scanning, since the name and student ID are already known.
- Once scanned, that student's existing row gets its fingerprint slot filled in (not a duplicate row) -- their `Today`/`Time` columns start working from then on.

Duplicate student IDs (already in the database) are skipped during import and reported back, so a partial import (e.g. "8 of 10 added, 2 skipped") won't silently lose data.
