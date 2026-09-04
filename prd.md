# PRD — Cypress Automation Recorder Browser Extension

## 1. Product Overview

### Product Name

**Cypress Recorder Extension**

### Product Description

Browser Extension yang memungkinkan QA atau Automation Engineer melakukan recording aktivitas pada website melalui browser. Setiap aktivitas yang direkam akan dikonversi menjadi automation test menggunakan **Cypress** dengan struktur **Page Object Model (POM)**.

User dapat melakukan recording tanpa menulis kode secara manual, kemudian melihat, mengedit, menjalankan, dan mengekspor hasil automation ke project Cypress.

---

## 2. Problem Statement

Membuat automation test Cypress secara manual membutuhkan:

- Penulisan script test.
- Pembuatan selector.
- Penyusunan Page Object Model.
- Pembuatan test scenario.
- Debugging script.

Proses tersebut membutuhkan waktu dan kemampuan teknis.

Dibutuhkan Browser Extension yang dapat:

1. Merekam aktivitas user pada website.
2. Mengidentifikasi element yang digunakan.
3. Membuat selector yang stabil.
4. Mengubah recording menjadi Cypress script.
5. Menghasilkan struktur Page Object Model.

---

## 3. Goals

### Primary Goals

- Mempercepat pembuatan automation Cypress.
- Mengurangi penulisan script secara manual.
- Menghasilkan struktur POM secara otomatis.
- Memungkinkan user melakukan recording langsung dari browser.
- Memungkinkan hasil recording dijalankan sebagai Cypress automation.

### Success Criteria

- User dapat merekam aktivitas website.
- Click dan input dapat direkam.
- Selector dapat dihasilkan otomatis.
- Recording dapat dikonversi menjadi Cypress script.
- POM dapat dibuat otomatis.
- Project Cypress dapat diekspor.
- Hasil automation dapat dijalankan.

---

# 4. Target Users

### Primary User

- QA Engineer
- Manual QA
- Automation Engineer
- QA Lead

### Secondary User

- Developer
- Product Engineer

---

# 5. Product Scope

## In Scope

### Recording

- Navigate website.
- Click element.
- Input text.
- Clear input.
- Select dropdown.
- Checkbox.
- Radio button.
- Keyboard action.
- Scroll.
- Form submission.

### Selector Generation

Extension harus mencoba menghasilkan selector berdasarkan prioritas:

1. `data-cy`
2. `data-testid`
3. `id`
4. `name`
5. `aria-label`
6. Unique CSS selector
7. XPath sebagai fallback

### Code Generation

Generate:

- Cypress Test Spec.
- Page Object Model.
- Custom command jika diperlukan.

### Project Export

User dapat mengunduh:

- Cypress project.
- Page Objects.
- Test specs.
- Configuration.

---

# 6. User Flow

## Flow Utama

### Step 1 — Open Extension

User membuka Cypress Recorder Extension.

### Step 2 — Input Target URL

User memasukkan URL website.

Contoh:

```text
https://example.com
```

### Step 3 — Start Recording

User menekan:

```text
Start Recording
```

Extension mulai memonitor aktivitas user.

### Step 4 — Perform Action

User melakukan aktivitas:

```text
Click Login
↓
Input Email
↓
Input Password
↓
Click Submit
```

### Step 5 — Stop Recording

User menekan:

```text
Stop Recording
```

### Step 6 — Review Steps

Extension menampilkan seluruh recorded steps.

Contoh:

| No  | Action | Element      | Value                                 |
| --- | ------ | ------------ | ------------------------------------- |
| 1   | Visit  | Login Page   | URL                                   |
| 2   | Type   | Email        | [user@test.com](mailto:user@test.com) |
| 3   | Type   | Password     | **\*\***                              |
| 4   | Click  | Login Button | -                                     |

### Step 7 — Generate Automation

User menekan:

```text
Generate Cypress
```

System menghasilkan:

- Test Spec.
- Page Object.
- Selector.

### Step 8 — Export

User dapat:

```text
Export Cypress Project
```

---

# 7. Browser Extension Architecture

Extension menggunakan arsitektur:

```text
Browser Extension
│
├── Popup UI
│
├── Content Script
│
├── Background Service Worker
│
├── Recorder Engine
│
├── Selector Engine
│
├── Code Generator
│
└── Storage
```

---

# 8. Core Features

## 8.1 Extension Popup

Popup Extension menampilkan:

### Before Recording

- Target URL.
- Start Recording button.
- Project Name.
- Test Name.

### During Recording

Menampilkan:

- Recording Status.
- Timer.
- Number of Recorded Steps.
- Pause Recording.
- Stop Recording.

### After Recording

Menampilkan:

- Recorded Steps.
- Generate Cypress.
- Edit Steps.
- Export Project.

---

# 9. Recording Engine

## Functional Requirement

Extension harus dapat menangkap event browser.

### Supported Events

#### Click

```javascript
element.click();
```

Output Cypress:

```javascript
cy.get('[data-cy="login"]').click();
```

---

#### Input

```text
user@test.com
```

Output:

```javascript
cy.get('[data-cy="email"]').type("user@test.com");
```

---

#### Clear Input

Output:

```javascript
cy.get('[data-cy="email"]').clear();
```

---

#### Dropdown

Output:

```javascript
cy.get('[data-cy="country"]').select("Indonesia");
```

---

#### Checkbox

Output:

```javascript
cy.get('[data-cy="terms"]').check();
```

---

#### Keyboard

Contoh:

```text
ENTER
```

Output:

```javascript
cy.get("input").type("{enter}");
```

---

# 10. Selector Engine

Selector Engine bertugas mencari selector terbaik.

## Selector Priority

```text
data-cy
↓
data-testid
↓
id
↓
name
↓
aria-label
↓
CSS Selector
↓
XPath
```

## Validation

Selector harus:

- Unik.
- Dapat menemukan satu element.
- Stabil.
- Tidak bergantung pada dynamic class jika memungkinkan.

---

# 11. Step Editor

User dapat mengedit hasil recording.

## Available Actions

User dapat:

- Edit action.
- Edit selector.
- Edit value.
- Delete step.
- Duplicate step.
- Reorder step.
- Add assertion.

Contoh:

```text
Click
Selector:
[data-cy="login-button"]
```

Menjadi:

```text
Click
Selector:
#login
```

---

# 12. Assertion Builder

User dapat menambahkan assertion.

## Supported Assertion

### Visible

```javascript
.should('be.visible')
```

### Exist

```javascript
.should('exist')
```

### Contain Text

```javascript
.should('contain', 'Success')
```

### Have Value

```javascript
.should('have.value', 'test')
```

### URL

```javascript
cy.url().should("include", "/dashboard");
```

---

# 13. Page Object Model Generator

System harus mengubah recording menjadi struktur POM.

## Generated Structure

```text
cypress/
│
├── e2e/
│   └── login/
│       └── login.cy.js
│
├── pages/
│   └── login/
│       └── LoginPage.js
│
├── locator/
│   └── login/
│       └── LoginLocator.js
│
├── fixtures/
│   └── login/
│       └── loginData.json
│
├── support/
│   ├── commands.js
│   └── e2e.js
│
└── config/
    └── environment.js
```

---

## Example Generated Page Object

Example Generated Locator
class LoginLocator {

emailInput() {
return '[data-cy="email"]'
}

passwordInput() {
return '[data-cy="password"]'
}

loginButton() {
return '[data-cy="login-button"]'
}

}

export default new LoginLocator()
Example Generated Page
import LoginLocator from '../../locators/login/LoginLocator'

class LoginPage {

inputEmail(email) {
cy.get(LoginLocator.emailInput()).type(email)
}

inputPassword(password) {
cy.get(LoginLocator.passwordInput()).type(password)
}

clickLogin() {
cy.get(LoginLocator.loginButton()).click()
}

}

export default new LoginPage()
Example Generated Test
import LoginPage from '../../pages/login/LoginPage'

describe('Login', () => {

it('User successfully login', () => {

    cy.visit('/login')

    LoginPage.inputEmail('user@test.com')
    LoginPage.inputPassword('password')
    LoginPage.clickLogin()

})

})

# 16. Local Storage

Data recording disimpan sementara menggunakan:

```text
Chrome Storage API
```

Data yang disimpan:

- Recording Session.
- Recorded Steps.
- Project Name.
- Test Name.
- User Settings.

---

# 17. UI Pages

## Page 1 — Extension Popup

Menampilkan:

```text
Project Name

Test Name

Target URL

[ Start Recording ]
```

---

## Page 2 — Recording Mode

Menampilkan:

```text
🔴 Recording

Duration: 02:30

Recorded Steps: 12

[ Pause ]

[ Stop Recording ]
```

---

## Page 3 — Recording Review

Menampilkan:

```text
Recorded Steps

1. Visit Login Page
2. Input Email
3. Input Password
4. Click Login
```

Action:

```text
Edit
Delete
Duplicate
Move
```

---

## Page 4 — Code Preview

Menampilkan tab:

```text
Test Script

Page Object

Selectors

Project Structure
```

---

# 18. Run Automation

## Challenge

Browser Extension tidak dapat menjalankan Cypress secara langsung karena Cypress membutuhkan environment Node.js.

## Solution

Extension dapat terhubung ke:

### Option A — Local Cypress Runner

User menjalankan Local Agent.

Arsitektur:

```text
Browser Extension
        ↓
Local API
        ↓
Cypress Runner
        ↓
Browser
```

### Option B — Export Project

User mengunduh project:

```text
Download ZIP
```

Kemudian:

```bash
npm install
npx cypress open
```

---

# 19. Local Agent

Untuk versi advanced.

User menginstall:

```text
Cypress Recorder Agent
```

Agent bertugas:

- Menyimpan Cypress project.
- Menjalankan Cypress.
- Mengirim execution result.
- Mengirim screenshot.
- Mengirim video.

---

# 20. Run Result

Menampilkan:

```text
Test Run Result

Status:
PASSED

Duration:
12.4 seconds

Steps:
10 Passed

Screenshots:
Available

Video:
Available
```

---

# 21. Error Handling

## Invalid URL

Menampilkan:

```text
URL tidak valid.
```

## Unsupported Website

Menampilkan:

```text
Website tidak dapat direkam.
```

## Element Not Found

Menampilkan:

```text
Selector tidak menemukan element.
```

## Dynamic Element

System memberikan warning:

```text
Selector mungkin tidak stabil.
```

---

# 22. Non-Functional Requirements

## Performance

- Recording action harus tercatat maksimal 500ms.
- Extension tidak boleh memperlambat website secara signifikan.

## Compatibility

Support:

- Google Chrome.
- Microsoft Edge.

## Security

- Jangan menyimpan password secara plain text.
- User dapat memilih untuk masking sensitive data.
- Jangan mengirim recording data ke server tanpa persetujuan user.

---

# 23. MVP Scope

Versi pertama fokus pada:

### Recording

✓ Visit URL
✓ Click
✓ Input
✓ Dropdown
✓ Checkbox
✓ Keyboard action

### Automation

✓ Generate selector
✓ Generate Cypress script
✓ Generate POM

### Management

✓ Edit step
✓ Delete step
✓ Reorder step

### Export

✓ Export Cypress project ZIP

---

# 24. Future Enhancement

## AI Selector Healing

Jika selector gagal:

```text
Old Selector
↓
Element Not Found
↓
AI Analysis
↓
New Selector
```

---

## AI Test Improvement

AI dapat:

- Memberikan assertion.
- Menambahkan validation.
- Mengidentifikasi missing scenario.
- Menyarankan edge case.

---

## Cloud Project

User dapat menyimpan:

```text
Projects
Recordings
Test Cases
Test Runs
```

---

## Team Collaboration

- Share recording.
- Review automation.
- Version history.
- Comment.

---

# 25. Definition of Done

✓ Extension dapat diinstall di Chrome
✓ User dapat memasukkan URL target
✓ Recorder dapat menangkap aktivitas website
✓ Click dapat direkam
✓ Input dapat direkam
✓ Dropdown dapat direkam
✓ Selector dapat dibuat otomatis
✓ Selector dapat divalidasi
✓ Step dapat diedit
✓ Step dapat dihapus
✓ Step dapat diurutkan ulang
✓ Cypress script dapat digenerate
✓ Page Object Model dapat digenerate
✓ Project Cypress dapat di-export
✓ Hasil export dapat dijalankan menggunakan Cypress

---

# 26. Recommended Tech Stack

## Browser Extension

```text
React
TypeScript
Manifest V3
Chrome Extension API
```

## Recording Engine

```text
Content Script
Mutation Observer
Browser Events API
```

## Storage

```text
Chrome Storage API
IndexedDB
```

## Code Generator

```text
Node.js
TypeScript
Template Generator
```

## Automation

```text
Cypress
```

## Export

```text
JSZip
```

---

# 27. Product Architecture

```text
┌──────────────────────────────┐
│      Browser Extension       │
│                              │
│  Popup / Dashboard           │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       Recorder Engine        │
│                              │
│ Click                       │
│ Input                       │
│ Select                      │
│ Keyboard                    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       Selector Engine        │
│                              │
│ data-cy                     │
│ data-testid                 │
│ id                          │
│ CSS                          │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│      Recording Session       │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│      Cypress Generator       │
│                              │
│ Test Spec                   │
│ Page Object Model           │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       Export / Runner        │
│                              │
│ ZIP Project                 │
│ Local Agent                 │
└──────────────────────────────┘
```

## 28. Final Product Vision

**Cypress Recorder Extension** adalah Browser Extension yang memungkinkan user melakukan:

```text
Open Website
      ↓
Start Recording
      ↓
Perform Actions
      ↓
Stop Recording
      ↓
Review Steps
      ↓
Generate Cypress + POM
      ↓
Run Automation
      ↓
Export Project
```

Tujuan akhirnya adalah membuat proses dari **Manual Testing → Cypress Automation** menjadi jauh lebih cepat tanpa mengharuskan QA menulis seluruh script dari nol.
