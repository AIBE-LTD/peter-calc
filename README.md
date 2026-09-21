# Peter Calculator

Deal calculator for **Peter Diamond, CBE®**. Separate copy of the completed calculator, with the calculation engine preserved.

Run `python preview.py` and open http://127.0.0.1:4175. Requires packages in requirements.txt.

Edit **EXCLUSIVELY PREPARED FOR**, enter the deal numbers, choose **Analyze Deal**, then **Download PDF**. Results open directly. Input changes require a fresh analysis before downloading.

Uses the original supplied Peter Diamond banner, two Bankability corner logos, a faint 45-degree watermark, and CBE® / Bankability Score® marks. DSCR quote and List Your Deal actions are hidden. Portfolio storage is namespaced for Peter; recipient names are not saved.

The four-page PDF uses Peter branding on each page and saves the latest local report beside this folder. Local review disables email, CRM, and other external submissions. The editable local rate assumption is 7.25%.

Production target: https://peter-calc.aibe.org. Deploy this repository as a Vite project on Vercel. The Python endpoint `/api/report` generates branded reports using `requirements.txt`; `/api/submit` is disabled. Run `npm ci` and `npm run build` to build the frontend.

Recipient names start blank on each visit and when choosing Pencil Another Deal. Previous saved recipient names are cleared; recipients are no longer stored.
