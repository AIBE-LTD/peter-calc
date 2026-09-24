# Peter Calculator

Peter Diamond, CBE® deal calculator with a branded four-page PDF. Calculations and PDF downloads work for guests. A user signed in **before** an analysis also saves that analysis and its original PDF to the shared Supabase account history.

## Local development

```sh
npm ci
python3 -m pip install -r requirements.txt
cp .env.example .env.local
# Set VITE_SUPABASE_PUBLISHABLE_KEY in .env.local
npm start
```

Open `http://127.0.0.1:4175/`. `npm start` builds the Vite frontend and runs `preview.py` with the real Python PDF endpoint. Set `PETER_PREVIEW_PORT` if port 4175 is occupied. The Python preview never sends email or CRM submissions. `npm test` and `npm run build` are the local checks.

Only the Supabase URL and **publishable** key belong in `VITE_` variables. Configure both in Vercel for Production, Preview, and Development; rebuild after changing them. Add this site's exact callback URLs to the shared project's Supabase Auth redirect allowlist. The browser keeps a separate session on each calculator origin.

## Shared account contract

The shared project is `ukbhfhofnnxmaixxaomh`. Peter's registry identity is `aa2c4ddc-8587-4da0-9b10-a76b211ec99e`, slug `peter-calculator`, payload version `1`. Its payload preserves `{preparedFor, advisor, inputs, results, reportDate}`. Peter's Python renderer retains its own branding and fixes the advisor identity server-side.

The [shared calculator contract](https://github.com/AIBE-LTD/luke-pencil-your-deal-calc/blob/b242e2ce2a9b6c4356d4f5b11d10c204cd3a9887/docs/shared-calculators.md) defines ownership, RLS, the private `calculator-reports` bucket, original-byte storage, retries, and cross-calculator history. The Luke repository owns migrations; Peter's registry migration lives there. Do not recreate the shared schema in this repository.

## PDF and history behavior

Analyze a deal to enable Download PDF. The button offers a visible Save PDF link in case the browser blocks automatic saving. Editing an input or starting another deal invalidates that download. Guests can download but their analyses do not enter cloud history. Signed-in reports save an immutable snapshot and PDF; failed saves can be retried, including pending rows recovered after reopening the originating calculator. My Results lists both calculators and downloads the original stored PDF bytes.

`api/submit.js` remains disabled for this edition. Account sign-in mail is sent by Supabase Auth; it is separate from lead or CRM delivery.

Production target: `https://peter-calc.aibe.org/`, deployed as a Vite project on Vercel. `api/report.py` uses `report.py`, ReportLab, Pillow, and the bundled `public/*.png` images. No Chromium runtime is needed for PDF downloads.
