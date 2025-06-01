// functions/test/updateUserProfile.test.js
const { testEnv, admin, myCloudFunctions, firestoreStub, sinon, chai } = require('./helpers');
const assert = chai.assert;
const { HttpsError } = require('firebase-functions/v1/https'); // To check error types

describe('Cloud Functions: updateUserProfile', () => {
    const testUid = 'testUser123';
    let wrappedUpdateUserProfile;

    before(() => {
        if (!myCloudFunctions.updateUserProfile) {
            throw new Error("Function 'updateUserProfile' is not exported from index.js or is undefined.");
        }
        wrappedUpdateUserProfile = myCloudFunctions.updateUserProfile; // onCall functions are called directly
    });

    beforeEach(() => {
        // Reset history for all stubs
        sinon.resetHistory(); // Resets history of all sinon stubs

        // Re-initialize specific behaviors for stubs if they were changed in a test
        // Default for successful update
        firestoreStub.update.resolves();
        // Default for user document get (e.g. for username check if current user has one)
        firestoreStub.doc.withArgs(testUid).get.resolves({ exists: true, id: testUid, data: () => ({ username: 'oldUsername' }) });
        // Default for username uniqueness check (username is available)
        firestoreStub.collection.withArgs('users').returnsThis(); // Ensure collection('users') is stubbed
        firestoreStub.where.returnsThis(); // where returns this
        firestoreStub.limit.returnsThis(); // limit returns this
        firestoreStub.get.resolves({ empty: true, docs: [] }); // Default to username available
    });

    after(() => {
        testEnv.cleanup();
        // sinon.restore(); // Restore all stubs globally after all test files if not done elsewhere
    });

    const mockContext = (uid) => {
        if (uid) return { auth: { uid } };
        return {}; // No auth
    };

    it('should update profile successfully with valid displayName and bio', async () => {
        const updateData = { displayName: 'New Name', bio: 'New Bio Details' };
        const result = await wrappedUpdateUserProfile(updateData, mockContext(testUid));

        assert.isTrue(firestoreStub.doc.calledWith(testUid), 'User document was not correctly referenced.');
        assert.isTrue(firestoreStub.update.calledOnce, 'Firestore update was not called.');
        const updatedFields = firestoreStub.update.firstCall.args[0];
        assert.equal(updatedFields.displayName, 'New Name');
        assert.equal(updatedFields.bio, 'New Bio Details');
        assert.deepEqual(updatedFields.lastUpdated, admin.firestore.FieldValue.serverTimestamp());
        assert.deepEqual(result, { success: true, message: 'Profile updated successfully.' });
    });

    it('should successfully update a valid unique username', async () => {
        const newUsername = 'newUniqueUser';
        // Ensure username check returns it's available (already default, but explicit for clarity)
        firestoreStub.where.withArgs('username', '==', newUsername).returnsThis();
        firestoreStub.get.resolves({ empty: true, docs: [] });

        const result = await wrappedUpdateUserProfile({ username: newUsername }, mockContext(testUid));

        assert.isTrue(firestoreStub.collection.calledWith('users'), "users collection wasn't queried for username check");
        assert.isTrue(firestoreStub.where.calledWith('username', '==', newUsername), "username query wasn't made");
        assert.isTrue(firestoreStub.update.calledOnce, 'Update was not called');
        const updatedFields = firestoreStub.update.firstCall.args[0];
        assert.equal(updatedFields.username, newUsername);
        assert.deepEqual(result, { success: true, message: 'Profile updated successfully.' });
    });

    it('should throw "unauthenticated" if no auth context', async () => {
        try {
            await wrappedUpdateUserProfile({ displayName: 'No Auth Name' }, mockContext(null)); // Pass null for unauthenticated
            assert.fail('Should have thrown an unauthenticated error');
        } catch (error) {
            assert.instanceOf(error, HttpsError, 'Error should be an HttpsError');
            assert.equal(error.code, 'unauthenticated');
            assert.equal(error.message, 'You must be logged in to update your profile.');
        }
    });

    it('should throw "already-exists" if username is taken by another user', async () => {
        const takenUsername = 'alreadyTakenUser';
        // Mock that 'takenUser' exists for a *different* UID
        firestoreStub.where.withArgs('username', '==', takenUsername).returnsThis();
        firestoreStub.get.resolves({
            empty: false,
            docs: [{ id: 'anotherUserUid', data: () => ({ username: takenUsername }) }]
        });

        try {
            await wrappedUpdateUserProfile({ username: takenUsername }, mockContext(testUid));
            assert.fail('Should have thrown an already-exists error for taken username');
        } catch (error) {
            assert.instanceOf(error, HttpsError, 'Error should be an HttpsError');
            assert.equal(error.code, 'already-exists');
        }
    });

    it('should allow setting username if current username is null and new username is unique', async () => {
        const newUsername = 'firstUsername';
        // Mock current user data having null username
        firestoreStub.doc.withArgs(testUid).get.resolves({ exists: true, id: testUid, data: () => ({ username: null }) });
        // Mock username 'firstUsername' is available (already default, explicit for clarity)
        firestoreStub.where.withArgs('username', '==', newUsername).returnsThis();
        firestoreStub.get.resolves({ empty: true, docs: [] });

        const result = await wrappedUpdateUserProfile({ username: newUsername }, mockContext(testUid));

        assert.isTrue(firestoreStub.update.calledOnce);
        const updatedFields = firestoreStub.update.firstCall.args[0];
        assert.equal(updatedFields.username, newUsername);
        assert.deepEqual(result, { success: true, message: 'Profile updated successfully.' });
    });

    it('should allow user to update their username to one they already have', async () => {
        const currentUsername = 'oldUsername'; // Matches the default stub for the user's current data
         // When checking for this username, the query should find the current user's document
        firestoreStub.where.withArgs('username', '==', currentUsername).returnsThis();
        firestoreStub.get.resolves({
            empty: false,
            docs: [{ id: testUid, data: () => ({ username: currentUsername }) }]
        });

        const result = await wrappedUpdateUserProfile({ username: currentUsername }, mockContext(testUid));
        assert.isTrue(firestoreStub.update.calledOnce, "Update should be called even if username is same, due to lastUpdated");
        const updatedFields = firestoreStub.update.firstCall.args[0];
        assert.equal(updatedFields.username, currentUsername);
        assert.deepEqual(result, { success: true, message: 'Profile updated successfully.' });
    });


    it('should throw "invalid-argument" for invalid username format (too short)', async () => {
        try {
            await wrappedUpdateUserProfile({ username: 'a' }, mockContext(testUid));
            assert.fail('Should have thrown for short username');
        } catch (e) {
            assert.instanceOf(e, HttpsError);
            assert.equal(e.code, 'invalid-argument');
        }
    });

    it('should throw "invalid-argument" for invalid displayName (empty string)', async () => {
        try {
            await wrappedUpdateUserProfile({ displayName: ' ' }, mockContext(testUid));
            assert.fail('Should have thrown for empty display name');
        } catch (e) {
            assert.instanceOf(e, HttpsError);
            assert.equal(e.code, 'invalid-argument');
        }
    });

    it('should return success with a message if no valid fields are provided for update', async () => {
        const result = await wrappedUpdateUserProfile({ unknownField: 'someValue' }, mockContext(testUid));
        assert.isFalse(firestoreStub.update.called, "Update should not be called if no valid fields are provided.");
        assert.deepEqual(result, { success: true, message: 'No valid fields provided for update or no changes made.' });
    });

    it('should allow clearing profilePictureUrl by passing null', async () => {
        const result = await wrappedUpdateUserProfile({ profilePictureUrl: null }, mockContext(testUid));
        assert.isTrue(firestoreStub.update.calledOnce);
        const updatedFields = firestoreStub.update.firstCall.args[0];
        assert.isNull(updatedFields.profilePictureUrl);
        assert.deepEqual(result, { success: true, message: 'Profile updated successfully.' });
    });

    it('should throw "invalid-argument" for invalid profilePictureUrl format', async () => {
        try {
            await wrappedUpdateUserProfile({ profilePictureUrl: 'not-a-url' }, mockContext(testUid));
            assert.fail('Should have thrown for invalid profilePictureUrl');
        } catch (e) {
            assert.instanceOf(e, HttpsError);
            assert.equal(e.code, 'invalid-argument');
        }
    });

});
