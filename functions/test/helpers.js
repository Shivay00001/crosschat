// functions/test/helpers.js
const admin = require('firebase-admin');
const testEnv = require('firebase-functions-test')({
    projectId: 'your-project-id-here', // User needs to replace this
    // databaseURL: 'https://your-project-id-here.firebaseio.com',
    // storageBucket: 'your-project-id-here.appspot.com',
}, 'path/to/your/service-account-key.json'); // User needs to replace this or handle auth for testing

// Initialize admin app if not already initialized to prevent re-initialization errors
if (admin.apps.length === 0) {
  admin.initializeApp();
}

// Import the functions to test (assuming they are exported from functions/index.js)
const myCloudFunctions = require('../index');

// Sinon setup
const sinon = require('sinon');

// Default stub for Firestore
const firestoreStub = {
  collection: sinon.stub().returnsThis(),
  doc: sinon.stub().returnsThis(),
  set: sinon.stub().resolves(),
  update: sinon.stub().resolves(),
  get: sinon.stub().resolves({ exists: true, data: () => ({}), id: 'testUid' }), // Default get stub
  where: sinon.stub().returnsThis(),
  limit: sinon.stub().returnsThis(),
  // Add other Firestore methods if they are used and need stubbing e.g. batch, runTransaction
};

// Stub admin.firestore() to return our detailed stub
// Ensure we are stubbing the getter for firestore if it's accessed as admin.firestore
if (admin.firestore && typeof admin.firestore === 'function' && !admin.firestore.isSinonProxy) {
    sinon.stub(admin, 'firestore').get(() => () => firestoreStub);
} else if (admin.firestore && typeof admin.firestore === 'object' && !admin.firestore.collection) { // If admin.firestore is already an object but not our stub
    // This case might occur if initializeApp somehow pre-stubs it differently.
    // For safety, let's ensure our stubs are applied.
    Object.assign(admin.firestore, firestoreStub);
} else if (!admin.firestore) { // If admin.firestore doesn't exist (less likely after initializeApp)
    sinon.stub(admin, 'firestore').get(() => () => firestoreStub);
}


module.exports = {
  testEnv,
  admin,
  myCloudFunctions,
  firestoreStub,
  sinon,
  chai: require('chai'), // Re-export chai for convenience
};
