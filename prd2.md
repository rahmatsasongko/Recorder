1. browser tidak perlu ditutup setiap kali membuat scenario.
2. Dalam file login.cy.js bisa lebih dari 1 scenario

┌──────────────────────────────────────────────┐
│ Test Suite: Login │
│ URL: https://example.com/login │
├──────────────────────────────────────────────┤
│ │
│ Scenario 1 │
│ ✓ Visit Login │
│ ✓ Input Username │
│ ✓ Input Password │
│ ✓ Click Login │
│ ✓ Assert Dashboard │
│ │
│ [+ Add Scenario] │
│ │
└──────────────────────────────────────────────┘

Scenario 1
↓
Save

Scenario 2
↓
Start Recording
↓
Save

Scenario 3
↓
Start Recording
↓
Save

Contoh:
Folder e2e
Folder user
user.cy.js
import UserPage from "../../pages/user/userPage";
import UserDetailPage from "../../pages/user/userDetailPage";
import { UserDetailData } from "../../data/user/user-detail.data";
import { UserMessage } from "../../messages/user/user.message";

describe("User Page", () => {
beforeEach(() => {
cy.visit("/login");
cy.login();
UserPage.goToPageUser();
});
it("User - 1 | Admin dapat melihat user Page", () => {
UserPage.verifyPageUser();
// validasi search bar muncul
UserPage.verifySearchBarVisible();
// validasi card stats muncul
UserPage.verifyStatCards(UserDetailData.statCardLabels);
// validasi tabel header muncul
UserPage.verifyTableHeaders(UserDetailData.tableHeaders.userList);
// validasi button view muncul
UserPage.verifyButtonViewUserVisible();
});

it("User - 2 | Admin dapat melihat Detail User page", () => {
// Search user berdasarkan email dari JSON
UserPage.searchUserByName(UserDetailData.userInfo.nama);
UserPage.verifyUserNameInTable(UserDetailData.userInfo.nama);

    // Click view untuk melihat detail
    UserDetailPage.clickViewUserFirst();
    UserDetailPage.verifyPageDetailUser();
    // Info User
    UserDetailPage.verifyTextVisible(UserDetailData.userInfo.nama);
    UserDetailPage.verifyTextVisible(UserDetailData.userInfo.email);
    UserDetailPage.verifyTextVisible(UserDetailData.userInfo.userId);
    UserDetailPage.verifyTextVisible(UserDetailData.userInfo.nomorTelepon);

    // Section & Header Tabel Daftar Perangkat
    UserDetailPage.verifySectionTitle(UserDetailData.sectionTitles.daftarPerangkat);
    UserDetailPage.verifyTableHeaders(UserDetailData.tableHeaders.daftarPerangkat);

    // Section & Header Tabel Metode Pembayaran
    UserDetailPage.verifySectionTitle(
      UserDetailData.sectionTitles.metodePembayaran,
    );
    UserDetailPage.verifyTableHeaders(
      UserDetailData.tableHeaders.metodePembayaran,
    );

    // Section & Header Tabel Transaction List
    UserDetailPage.verifySectionTitle(UserDetailData.sectionTitles.transaksi);
    UserDetailPage.verifyTableHeaders(UserDetailData.tableHeaders.transaksi);

});

it("User - 3 | Admin dapat melihat transaksi BRT New yang dilakukan User", () => {
UserPage.searchUserByEmail(UserDetailData.userInfo.email);
UserPage.verifyUserNameInTable(UserDetailData.userInfo.nama);
UserDetailPage.clickViewUserFirst();
UserDetailPage.verifyPageDetailUser();
UserDetailPage.clickTabBRT();
UserDetailPage.verifyTransaksiListVisible();
});

it("User - 4 | Admin dapat melihat transaksi Royal Trans yang dilakukan User", () => {
UserPage.searchUserByEmail(UserDetailData.userInfo.email);
UserPage.verifyUserNameInTable(UserDetailData.userInfo.nama);
UserDetailPage.clickViewUserFirst();
UserDetailPage.verifyPageDetailUser();
UserDetailPage.clickTabRoyalTrans();
UserDetailPage.verifyTransaksiListVisible();
});

it("User - 5 | Admin dapat melihat transaksi Open Top Tour yang dilakukan User", () => {
UserPage.searchUserByEmail(UserDetailData.userInfo.email);
UserPage.verifyUserNameInTable(UserDetailData.userInfo.nama);
UserDetailPage.clickViewUserFirst();
UserDetailPage.verifyPageDetailUser();
UserDetailPage.clickTabOpenTopTour();
UserDetailPage.verifyTransaksiListVisible();
});

it("User - 6 | Admin dapat search user berdasarkan Nama, User ID, Email, dan Phone Number", () => {
// Search by Nama
UserPage.searchUserByName(UserDetailData.userInfo.nama);
UserPage.verifyUserNameInTable(UserDetailData.userInfo.nama);
UserPage.clearSearchBar();

    // Search by User ID
    UserPage.searchUserByUserId(UserDetailData.userInfo.userId);
    UserPage.verifyUserNameInTable(UserDetailData.userInfo.userId);
    UserPage.clearSearchBar();

    // Search by Email
    UserPage.searchUserByEmail(UserDetailData.userInfo.email);
    UserPage.verifyUserNameInTable(UserDetailData.userInfo.email);
    UserPage.clearSearchBar();

    // Search by Phone Number
    UserPage.searchUserByPhone(UserDetailData.userInfo.nomorTelepon);
    UserPage.verifyUserNameInTable(UserDetailData.userInfo.nomorTelepon);
    UserPage.clearSearchBar();

});

});

Folder locator
Folder auth
locator-auth.js
export const locatorAuth = {
inputEmail: '[data-testid="email-input"]',
inputPassword: '[data-testid="input-password"]',
buttonLogin: '[data-testid="button-login"]',
buttonlogout: '[data-testid="button-logout"]',
}

Folder messages
Folder auth
login.message.js
export const LoginMessage = {
ERROR_EMAIL_REQUIRED: "Email tidak boleh kosong",
ERROR_PASSWORD_REQUIRED: "Password tidak boleh kosong",
ERROR_EMAIL_NOT_REGISTERED: "Akun tidak ditemukan. Periksa email yang Anda gunakan",
ERROR_PASSWORD_INCORRECT: "Kata sandi salah. Periksa kembali dan coba lagi.",
}

Folder pages
folder auth
loginPage.js
import {LoginData} from "../../data/auth/login.data";
import { locatorAuth } from "../../locator/auth/locator-auth";
import { LoginMessage } from "../../messages/auth/login.message";

class LoginPage {

inputEmail(email) {
cy.get(locatorAuth.inputEmail).clear().type(email);
}

inputPassword(password) {
cy.get(locatorAuth.inputPassword).clear().type(password);
}

clickbuttonLogin() {
cy.get(locatorAuth.buttonLogin).click();
}

login(email, password) {
this.inputEmail(LoginData.validuser.email);
this.inputPassword(LoginData.validuser.password);
this.clickbuttonLogin();
this.verifyDashboardIsLoaded();
}

verifyDashboardIsLoaded() {
cy.url().should("include", "/laporan/report-list");
}

VerifyEmailIsRequired() {
cy.contains(LoginMessage.ERROR_EMAIL_REQUIRED).should("be.visible");
}

VerifyPasswordIsRequired() {
cy.contains(LoginMessage.ERROR_PASSWORD_REQUIRED).should("be.visible");
}

VerifyEmailNotRegistered() {
cy.contains(LoginMessage.ERROR_EMAIL_NOT_REGISTERED).should("be.visible");
}

VerifyPasswordIncorrect() {
cy.contains(LoginMessage.ERROR_PASSWORD_INCORRECT).should("be.visible");
}

logout() {
cy.get(locatorAuth.buttonlogout).click();
}
}

export default new LoginPage();

cypress.config.js
const { defineConfig } = require("cypress");

module.exports = defineConfig({
allowCypressEnv: false,

e2e: {
pageLoadTimeout: 60000,
viewportWidth: 1920,
viewportHeight: 1080,
baseUrl: "https://stg-tije-dashboard.transjakarta.co.id/",
setupNodeEvents(on, config) {
// implement node event listeners here
},
},
});
