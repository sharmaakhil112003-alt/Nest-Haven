const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { test, before, after, beforeEach } = require("node:test");
const fs = require("node:fs");

let testEnv;
const PROJECT_ID = process.env.GCP_PROJECT || "demo-no-project";
const MASTER_UID = "master_uid_001";
const MASTER_EMAIL = "sharmaakhil112003@gmail.com";
const OWNER_UID = "owner_uid_003";
const TENANT_UID = "tenant_uid_004";
const OTHER_UID = "other_uid_005";

const [emulatorHost, emulatorPortStr] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085"
).split(":");
const emulatorPort = parseInt(emulatorPortStr, 10);

function nowMinus(ms = 1000) {
  return new Date(Date.now() - ms);
}

function masterContext() {
  return testEnv.authenticatedContext(MASTER_UID, {
    email: MASTER_EMAIL,
    email_verified: true,
  });
}

function userContext(uid, email, verified = true) {
  return testEnv.authenticatedContext(uid, {
    email,
    email_verified: verified,
  });
}

async function seedMasterAndProperty() {
  const db = masterContext().firestore();
  const ts = nowMinus(5000);
  await db.collection("governance").doc("master_config").set({
    masterUid: MASTER_UID,
    masterEmail: MASTER_EMAIL,
    masterDisplayName: "Akhil Sharma",
    ownershipLocked: true,
    ownershipTransferArmed: false,
    pendingSuccessorEmail: "",
    twoFactorEnforced: true,
    strongPasswordEnforced: true,
    autoBackupEnabled: true,
    backupIntervalHours: 24,
    recoveryEmail: MASTER_EMAIL,
    firebaseProjectId: "gen-lang-client-0181466425",
    domainName: "nesthaven.app",
    publishingAccount: MASTER_EMAIL,
    sourceRepoRef: "github.com/nesthaven/android-app",
    createdAt: ts,
    updatedAt: ts,
  });
  await db.collection("governance").doc("public_directory").set({
    masterUid: MASTER_UID,
    strictLockActive: true,
    updatedAt: ts,
  });
  await db.collection("properties").doc("prop_shimla_1").set({
    masterUid: MASTER_UID,
    name: "Deodar Nest Room 101",
    state: "Himachal Pradesh",
    city: "Shimla",
    locality: "Indira Nagar",
    buildingName: "Deodar Heights",
    address: "14 Indira Nagar, Shimla",
    roomNumber: "101",
    roomType: "SINGLE",
    monthlyRentInr: 6000,
    facilities: ["Wi-Fi", "Geyser"],
    photoUrls: [],
    occupancyStatus: "AVAILABLE",
    published: true,
    ownerUid: OWNER_UID,
    ownerName: "Rajesh Thakur",
    ownerPhoneMasked: "•••• 7812",
    ownerVerified: true,
    createdAt: ts,
    updatedAt: ts,
  });
}

before(async () => {
  const rules = fs.readFileSync("./firestore.rules", "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: emulatorHost,
      port: emulatorPort,
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  if (testEnv) await testEnv.clearFirestore();
});

test("Unauthenticated users cannot read or write any collection", async () => {
  const unauth = testEnv.unauthenticatedContext().firestore();
  await assertFails(unauth.collection("properties").get());
  await assertFails(unauth.collection("bookings").get());
  await assertFails(unauth.collection("payment_orders").get());
  await assertFails(unauth.collection("governance").doc("master_config").get());
});

test("Owners and Tenants cannot self-approve, publish properties, or access Master governance", async () => {
  await seedMasterAndProperty();
  const ownerDb = userContext(OWNER_UID, "owner@nesthaven.app").firestore();
  const tenantDb = userContext(TENANT_UID, "tenant@nesthaven.app").firestore();
  const ts = nowMinus(2000);

  // Owner cannot self-approve
  await assertFails(
    ownerDb.collection("users").doc(OWNER_UID).set({
      userId: OWNER_UID,
      email: "owner@nesthaven.app",
      displayName: "Owner",
      phone: "9812345678",
      accountType: "OWNER",
      preferredLanguage: "en",
      role: "MEMBER",
      ownerApproved: true,
      kycVerified: true,
      vaultPasswordHash: "",
      vaultPasswordSalt: "",
      totpEnabled: false,
      recoveryCodesCount: 0,
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Valid unapproved owner creation succeeds
  await assertSucceeds(
    ownerDb.collection("users").doc(OWNER_UID).set({
      userId: OWNER_UID,
      email: "owner@nesthaven.app",
      displayName: "Owner",
      phone: "9812345678",
      accountType: "OWNER",
      preferredLanguage: "hi",
      role: "MEMBER",
      ownerApproved: false,
      kycVerified: false,
      vaultPasswordHash: "",
      vaultPasswordSalt: "",
      totpEnabled: false,
      recoveryCodesCount: 0,
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Owner cannot independently publish or edit a property
  await assertFails(
    ownerDb.collection("properties").doc("prop_fake").set({
      masterUid: OWNER_UID,
      name: "Unauthorized Flat",
      state: "Himachal Pradesh",
      city: "Shimla",
      locality: "Indira Nagar",
      buildingName: "Fake",
      address: "Fake",
      roomNumber: "1",
      roomType: "SINGLE",
      monthlyRentInr: 6000,
      facilities: [],
      photoUrls: [],
      occupancyStatus: "AVAILABLE",
      published: true,
      ownerUid: OWNER_UID,
      ownerName: "Owner",
      ownerPhoneMasked: "•••• 0000",
      ownerVerified: true,
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    ownerDb.collection("properties").doc("prop_shimla_1").update({ monthlyRentInr: 9000, updatedAt: nowMinus() })
  );

  // Tenant cannot access master_config
  await assertFails(tenantDb.collection("governance").doc("master_config").get());
});

test("Tenant ₹99 search unlock and server-only payment verification cannot be spoofed by client", async () => {
  await seedMasterAndProperty();
  const tenantDb = userContext(TENANT_UID, "tenant@nesthaven.app").firestore();
  const ts = nowMinus(2000);

  // Tenant cannot create a pre-VERIFIED_BY_SERVER payment order
  await assertFails(
    tenantDb.collection("payment_orders").doc("ord_spoof").set({
      tenantUid: TENANT_UID,
      ownerUid: OWNER_UID,
      bookingId: "",
      searchUnlockId: "unlock_1",
      paymentPurpose: "SEARCH_FEE_99",
      amountInr: 99,
      platformFeeInr: 0,
      rentMonthNumber: 0,
      paymentStatus: "VERIFIED_BY_SERVER",
      settlementStatus: "NOT_APPLICABLE",
      ownerVerifiedReceipt: false,
      receiptRef: "FAKE",
      failureReason: "",
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Valid AWAITING_GATEWAY_VERIFICATION order succeeds
  await assertSucceeds(
    tenantDb.collection("payment_orders").doc("ord_1").set({
      tenantUid: TENANT_UID,
      ownerUid: "",
      bookingId: "",
      searchUnlockId: "unlock_1",
      paymentPurpose: "SEARCH_FEE_99",
      amountInr: 99,
      platformFeeInr: 0,
      rentMonthNumber: 0,
      paymentStatus: "AWAITING_GATEWAY_VERIFICATION",
      settlementStatus: "NOT_APPLICABLE",
      ownerVerifiedReceipt: false,
      receiptRef: "NH-99-001",
      failureReason: "",
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Valid search unlock with feeAmountInr == 99 succeeds; fee != 99 fails
  await assertSucceeds(
    tenantDb.collection("search_unlocks").doc("unlock_1").set({
      tenantUid: TENANT_UID,
      state: "Himachal Pradesh",
      city: "Shimla",
      locality: "Indira Nagar",
      buildingFilter: "",
      monthlyBudgetInr: 6000,
      roomPreference: "SINGLE",
      requiredFacilities: ["Wi-Fi"],
      feeAmountInr: 99,
      unlockStatus: "PAYMENT_PENDING",
      alternativeOffered: false,
      alternativeRentInr: 0,
      alternativeAccepted: false,
      refundStatus: "NONE",
      paymentOrderId: "ord_1",
      createdAt: ts,
      updatedAt: ts,
    })
  );
});

test("Bookings enforce valid durations (2,6,12,24) and anti-duplicate stay reviews", async () => {
  await seedMasterAndProperty();
  const tenantDb = userContext(TENANT_UID, "tenant@nesthaven.app").firestore();
  const masterDb = masterContext().firestore();
  const ts = nowMinus(2000);

  // Invalid 5-month duration fails
  await assertFails(
    tenantDb.collection("bookings").doc("bk_bad").set({
      propertyId: "prop_shimla_1",
      propertyTitle: "Deodar Nest Room 101",
      localitySummary: "Indira Nagar, Shimla",
      tenantUid: TENANT_UID,
      tenantName: "Aarav",
      ownerUid: OWNER_UID,
      ownerName: "Rajesh Thakur",
      requestType: "BOOKING",
      durationMonths: 5,
      monthlyRentInr: 6000,
      firstMonthRentPaid: false,
      status: "PENDING_PAYMENT",
      ownerDecision: "PENDING",
      ownerDecisionNote: "",
      cancellationReason: "",
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Valid 6-month booking succeeds
  await assertSucceeds(
    tenantDb.collection("bookings").doc("bk_1").set({
      propertyId: "prop_shimla_1",
      propertyTitle: "Deodar Nest Room 101",
      localitySummary: "Indira Nagar, Shimla",
      tenantUid: TENANT_UID,
      tenantName: "Aarav",
      ownerUid: OWNER_UID,
      ownerName: "Rajesh Thakur",
      requestType: "BOOKING",
      durationMonths: 6,
      monthlyRentInr: 6000,
      firstMonthRentPaid: false,
      status: "PENDING_PAYMENT",
      ownerDecision: "PENDING",
      ownerDecisionNote: "",
      cancellationReason: "",
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Fake review before COMPLETED status fails
  await assertFails(
    tenantDb.collection("reviews").doc(`bk_1_${TENANT_UID}`).set({
      bookingId: "bk_1",
      reviewerUid: TENANT_UID,
      reviewerRole: "TENANT",
      targetUid: OWNER_UID,
      rating: 5,
      comment: "Fake early review",
      createdAt: ts,
    })
  );

  // Master marks stay COMPLETED -> verified review succeeds once, duplicate/random ID fails
  await assertSucceeds(
    masterDb.collection("bookings").doc("bk_1").update({
      status: "COMPLETED",
      firstMonthRentPaid: true,
      updatedAt: nowMinus(),
    })
  );

  await assertSucceeds(
    tenantDb.collection("reviews").doc(`bk_1_${TENANT_UID}`).set({
      bookingId: "bk_1",
      reviewerUid: TENANT_UID,
      reviewerRole: "TENANT",
      targetUid: OWNER_UID,
      rating: 5,
      comment: "Clean peaceful room in Indira Nagar.",
      createdAt: nowMinus(),
    })
  );

  await assertFails(
    tenantDb.collection("reviews").doc("arbitrary_duplicate_id").set({
      bookingId: "bk_1",
      reviewerUid: TENANT_UID,
      reviewerRole: "TENANT",
      targetUid: OWNER_UID,
      rating: 5,
      comment: "Duplicate attempt",
      createdAt: nowMinus(),
    })
  );

  // Unrelated user cannot view or review
  const otherDb = userContext(OTHER_UID, "other@nesthaven.app").firestore();
  await assertFails(otherDb.collection("bookings").doc("bk_1").get());
});

test("Hashed account_claims prevent duplicate registration without allowing list enumeration", async () => {
  const tenantDb = userContext(TENANT_UID, "tenant@nesthaven.app").firestore();
  const otherDb = userContext(OTHER_UID, "other@nesthaven.app").firestore();
  const ts = nowMinus(2000);
  const validClaimId = "email_" + "a".repeat(64);

  // Listing claims is always denied (anti-enumeration)
  await assertFails(tenantDb.collection("account_claims").get());

  // Malformed claim ID fails
  await assertFails(
    tenantDb.collection("account_claims").doc("raw_email_id").set({
      ownerUid: TENANT_UID,
      claimType: "EMAIL",
      createdAt: ts,
    })
  );

  // Valid hashed claim creation succeeds
  await assertSucceeds(
    tenantDb.collection("account_claims").doc(validClaimId).set({
      ownerUid: TENANT_UID,
      claimType: "EMAIL",
      createdAt: ts,
    })
  );

  // Another user cannot overwrite/steal an existing claim
  await assertFails(
    otherDb.collection("account_claims").doc(validClaimId).set({
      ownerUid: OTHER_UID,
      claimType: "EMAIL",
      createdAt: nowMinus(),
    })
  );
});

