// functions/test/getUserProfile.test.js
const { testEnv, admin, myCloudFunctions, firestoreStub, sinon, chai } = require('./helpers');
const assert = chai.assert;
const { HttpsError } = require('firebase-functions/v1/https');

describe('Cloud Functions: getUserProfile', () => {
    const ownerUid = 'ownerUser123';
    const otherUid = 'otherUser456';
    let wrappedGetUserProfile;

    // Define a base full profile; use a function to get a fresh copy for each test setup
    const getFullProfileData = (uid, username) => ({
        // Fields as stored in Firestore (uid is doc ID, not in data itself usually)
        username: username || 'owner',
        displayName: 'Owner Name',
        email: 'owner@example.com', // Private
        phoneNumber: '1234567890', // Private
        bio: 'This is the owner bio.',
        profilePictureUrl: 'http://example.com/owner.jpg',
        followersCount: 10,
        followingCount: 5,
        postsCount: 2,
        dateJoined: admin.firestore.Timestamp.fromDate(new Date()), // Use Firestore Timestamp
        lastUpdated: admin.firestore.Timestamp.fromDate(new Date()),
        privacySettings: { emailVisibility: 'private', phoneVisibility: 'private' }
    });

    // Define what a public profile should look like based on fullProfileData
    // The function itself adds the 'uid' field to the returned object.
    const getPublicProfileDataSubset = (uid, fullData) => ({
        uid: uid, // Function adds this
        username: fullData.username,
        displayName: fullData.displayName,
        bio: fullData.bio,
        profilePictureUrl: fullData.profilePictureUrl,
        followersCount: fullData.followersCount,
        followingCount: fullData.followingCount,
        postsCount: fullData.postsCount,
        dateJoined: fullData.dateJoined, // Ensure this matches the type from fullData
    });

    // The function under test adds the UID to the returned object.
    const ownerFullProfileExpected = { uid: ownerUid, ...getFullProfileData(ownerUid, 'owner')};
    const ownerPublicProfileExpected = getPublicProfileDataSubset(ownerUid, getFullProfileData(ownerUid, 'owner'));


    before(() => {
        if (!myCloudFunctions.getUserProfile) {
            throw new Error("Function 'getUserProfile' is not exported from index.js or is undefined.");
        }
        wrappedGetUserProfile = myCloudFunctions.getUserProfile; // onCall, no testEnv.wrap
    });

    beforeEach(() => {
        sinon.resetHistory();

        const ownerDataFromDb = getFullProfileData(ownerUid, 'owner');

        // Default stub for successful profile fetch by UID (owner)
        firestoreStub.doc.withArgs(ownerUid).get.resolves({
            exists: true,
            id: ownerUid,
            data: () => ({...ownerDataFromDb}) // Return a fresh copy
        });
        // Default stub for successful profile fetch by username (owner's username)
        firestoreStub.collection.withArgs('users').returnsThis();
        firestoreStub.where.withArgs('username', '==', ownerDataFromDb.username).returnsThis();
        firestoreStub.limit.withArgs(1).returnsThis();
        firestoreStub.get.resolves({
            empty: false,
            docs: [{
                id: ownerUid,
                data: () => ({...ownerDataFromDb}) // Return a fresh copy
            }]
        });
        // Default for non-existent user
        firestoreStub.doc.withArgs('nonExistentId').get.resolves({ exists: false, id: 'nonExistentId' });
        firestoreStub.where.withArgs('username', '==', 'nonExistentUser').limit(1).get.resolves({ empty: true, docs: [] });

    });

    after(() => {
        testEnv.cleanup();
        sinon.restore(); // Restore all sinon stubs after this test file runs
    });

    const mockContext = (uid) => {
        if (uid) return { auth: { uid } };
        return {}; // No auth
    };

    it('should return full profile for owner when fetching by userId', async () => {
        const result = await wrappedGetUserProfile({ userId: ownerUid }, mockContext(ownerUid));
        assert.deepEqual(result, ownerFullProfileExpected);
    });

    it('should return public profile for non-owner when fetching by userId', async () => {
        const result = await wrappedGetUserProfile({ userId: ownerUid }, mockContext(otherUid));
        assert.deepEqual(result, ownerPublicProfileExpected);
    });

    it('should return public profile for unauthenticated user when fetching by userId', async () => {
        const result = await wrappedGetUserProfile({ userId: ownerUid }, mockContext(null));
        assert.deepEqual(result, ownerPublicProfileExpected);
    });

    it('should return full profile for owner when fetching by username', async () => {
        const result = await wrappedGetUserProfile({ username: ownerFullProfileExpected.username }, mockContext(ownerUid));
        assert.deepEqual(result, ownerFullProfileExpected);
    });

    it('should return public profile for non-owner when fetching by username', async () => {
        const result = await wrappedGetUserProfile({ username: ownerFullProfileExpected.username }, mockContext(otherUid));
        assert.deepEqual(result, ownerPublicProfileExpected);
    });

    it('should throw "not-found" if profile does not exist (fetch by userId)', async () => {
        try {
            await wrappedGetUserProfile({ userId: 'nonExistentId' }, mockContext(null));
            assert.fail('Should have thrown not-found error');
        } catch (error) {
            assert.instanceOf(error, HttpsError);
            assert.equal(error.code, 'not-found');
        }
    });

    it('should throw "not-found" if profile does not exist (fetch by username)', async () => {
        try {
            await wrappedGetUserProfile({ username: 'nonExistentUser' }, mockContext(null));
            assert.fail('Should have thrown not-found error');
        } catch (error) {
            assert.instanceOf(error, HttpsError);
            assert.equal(error.code, 'not-found');
        }
    });

    it('should throw "invalid-argument" if neither userId nor username is provided', async () => {
        try {
            await wrappedGetUserProfile({}, mockContext(null)); // Empty data object
            assert.fail('Should have thrown invalid-argument error');
        } catch (error) {
            assert.instanceOf(error, HttpsError);
            assert.equal(error.code, 'invalid-argument');
            assert.include(error.message, 'You must provide either a userId or a username');
        }
    });

    it('should throw "invalid-argument" if userId is an empty string', async () => {
        try {
            await wrappedGetUserProfile({ userId: " " }, mockContext(null));
            assert.fail('Should have thrown invalid-argument error for empty userId');
        } catch (error) {
            assert.instanceOf(error, HttpsError);
            assert.equal(error.code, 'invalid-argument');
            assert.include(error.message, 'Provided userId must be a non-empty string');
        }
    });

    it('should throw "invalid-argument" if username is an empty string', async () => {
        try {
            await wrappedGetUserProfile({ username: " " }, mockContext(null));
            assert.fail('Should have thrown invalid-argument error for empty username');
        } catch (error) {
            assert.instanceOf(error, HttpsError);
            assert.equal(error.code, 'invalid-argument');
            assert.include(error.message, 'Provided username must be a non-empty string');
        }
    });
});
