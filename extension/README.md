# QA Web Recorder (Tije-Test)

Rekam aksi di halaman web dan ubah jadi test Cypress, Playwright, WebdriverIO,
atau Selenium dengan struktur Page Object Model (Locator → Page → Spec, plus
Messages & Data).

## Keterbatasan yang diketahui

- **iframe** — Ekstensi hanya merekam dan memutar ulang elemen di top-level
  frame halaman. Elemen di dalam `<iframe>` (mis. widget pembayaran, dashboard
  yang di-embed) tidak bisa direkam atau diklik saat playback. Recorder akan
  menampilkan peringatan saat mendeteksi iframe di halaman yang sedang direkam.
- **Shadow DOM** — Elemen di dalam shadow root tidak bisa ditemukan oleh
  selector engine.
- **Upload file** — Tidak bisa diputar ulang langsung di tab (browser tidak
  mengizinkan ekstensi mengisi dialog pilih file dari script). Upload file
  didukung penuh di project Cypress/Playwright/WebdriverIO/Selenium hasil ekspor.
- **WebdriverIO/Selenium drag-and-drop (HTML5)** — Kode yang di-generate
  menyertakan komentar `TODO` bila drag-and-drop halaman memakai HTML5 Drag
  and Drop API; mungkin perlu penyesuaian manual dengan `browser.execute()`
  (WebdriverIO) atau `driver.executeScript()` (Selenium).
- **Permintaan backend (XHR/fetch)** — Recorder tidak bisa menyimpulkan kapan
  harus menunggu respons API. Tambahkan `cy.intercept()` /
  `page.waitForResponse()` / `browser.waitUntil()` secara manual di kode hasil
  generate bila diperlukan.

## Data & penyimpanan

Semua data (suite, scenario, step) disimpan lokal di `chrome.storage.local` —
tidak ada sinkronisasi ke server manapun. Gunakan "Export all suites" secara
berkala sebagai cadangan.

## Password

Isian password (`type=password`, atau kolom yang namanya jelas password/sandi)
ditandai `sensitive` saat direkam:

- **Di ekstensi** — nilainya tetap tersimpan apa adanya di `chrome.storage.local`
  karena "Play in browser" harus mengetiknya kembali. Di editor step nilainya
  disamarkan, dan tidak pernah dicetak di log playback.
- **Di proyek hasil generate** — password **tidak** ditulis ke file `*.data.js`.
  File itu membacanya dari environment (`secret("LOGIN_PASSWORD")`), dan proyek
  menyertakan `.env.example` (`cypress.env.example.json` untuk Cypress), `.gitignore`,
  serta bagian "Secrets" di README yang mendaftar variabel yang harus diisi.
- **Di ZIP hasil export** — `.cypress-recorder/session.json` di dalamnya juga
  dikosongkan nilai passwordnya. Saat ZIP itu diimpor kembali, step-nya tetap
  ada; isi ulang passwordnya di editor sebelum di-play.
- **Cadangan pribadi** ("Export all suites", "Simpan session") sengaja tetap
  menyimpan password supaya bisa dipulihkan sepenuhnya. Jangan dibagikan atau
  di-commit; ekstensi memberi peringatan saat file seperti itu berisi password.
