const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

exports.helloWorld = functions.https.onRequest((request, response) => {
  functions.logger.info("Hello logs!", {structuredData: true});
  response.send("Hello from Firebase!");
});

exports.onCreateUser = functions.auth.user().onCreate(async (user) => {
  try {
    const userRef = db.collection("users").doc(user.uid);

    await userRef.set({
      email: user.email,
      displayName: user.displayName || null,
      profilePictureUrl: user.photoURL || null,
      dateJoined: admin.firestore.FieldValue.serverTimestamp(),
      followersCount: 0,
      followingCount: 0,
      postsCount: 0,
      username: null,
      bio: "",
      phoneNumber: null,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      privacySettings: {
        emailVisibility: "private",
        phoneVisibility: "private",
      },
    });

    functions.logger.info(`User document created for UID: ${user.uid}`);
  } catch (error) {
    functions.logger.error(`Error creating user document for UID: ${user.uid}`, error);
  }
});

exports.updateUserProfile = functions.https.onCall(async (data, context) => {
  functions.logger.info("updateUserProfile called with data:", data, {uid: context.auth ? context.auth.uid : 'unauthenticated'});

  if (!context.auth) {
    functions.logger.warn("User unauthenticated for updateUserProfile.");
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to update your profile.');
  }
  const uid = context.auth.uid;

  const updatePayload = {};

  if (data.displayName !== undefined) {
    if (typeof data.displayName === 'string' && data.displayName.trim() !== '') {
      updatePayload.displayName = data.displayName.trim();
    } else {
      functions.logger.error("Validation failed: displayName must be a non-empty string.", {uid, displayName: data.displayName});
      throw new functions.https.HttpsError('invalid-argument', 'Display name must be a non-empty string.');
    }
  }

  if (data.bio !== undefined) {
    if (typeof data.bio === 'string') {
      updatePayload.bio = data.bio;
    } else {
      functions.logger.error("Validation failed: bio must be a string.", {uid, bio: data.bio});
      throw new functions.https.HttpsError('invalid-argument', 'Bio must be a string.');
    }
  }

  if (data.profilePictureUrl !== undefined) {
    if (data.profilePictureUrl === null || (typeof data.profilePictureUrl === 'string' && data.profilePictureUrl.trim() === '')) {
        updatePayload.profilePictureUrl = null;
    } else if (typeof data.profilePictureUrl === 'string' && (data.profilePictureUrl.startsWith('http://') || data.profilePictureUrl.startsWith('https://'))) {
        updatePayload.profilePictureUrl = data.profilePictureUrl.trim();
    } else {
      functions.logger.error("Validation failed: profilePictureUrl must be a valid URL or null.", {uid, profilePictureUrl: data.profilePictureUrl});
      throw new functions.https.HttpsError('invalid-argument', 'Profile picture URL must be a valid URL or null to clear.');
    }
  }

  if (data.username !== undefined) {
    const username = data.username;
    if (typeof username === 'string' && username.trim() !== '') {
      const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
      if (!usernameRegex.test(username)) {
        functions.logger.error("Validation failed: username format invalid.", {uid, username});
        throw new functions.https.HttpsError('invalid-argument', 'Username must be 3-20 characters long and contain only alphanumeric characters and underscores.');
      }
      const usersRef = db.collection('users');
      const snapshot = await usersRef.where('username', '==', username).limit(1).get();
      if (!snapshot.empty) {
        let existingUserConflict = false;
        snapshot.forEach(doc => { if (doc.id !== uid) existingUserConflict = true; });
        if (existingUserConflict) {
          functions.logger.error("Validation failed: username already taken.", {uid, username});
          throw new functions.https.HttpsError('already-exists', 'This username is already taken.');
        }
      }
      updatePayload.username = username;
    } else {
      functions.logger.error("Validation failed: username must be a non-empty string.", {uid, username: data.username});
      throw new functions.https.HttpsError('invalid-argument', 'Username must be a non-empty string.');
    }
  }

  if (Object.keys(updatePayload).length > 0) {
    updatePayload.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
    try {
      await db.collection('users').doc(uid).update(updatePayload);
      functions.logger.info(`Profile updated successfully for UID: ${uid}`, {updatePayload});
      return { success: true, message: 'Profile updated successfully.' };
    } catch (error) {
      functions.logger.error(`Error updating profile for UID: ${uid}`, error);
      throw new functions.https.HttpsError('internal', 'Failed to update profile.');
    }
  } else {
    functions.logger.info(`No valid fields to update for UID: ${uid}`, {providedData: data});
    return { success: true, message: 'No valid fields provided for update or no changes made.' }; // Changed to success: true as per common API patterns
  }
});

exports.getUserProfile = functions.https.onCall(async (data, context) => {
  functions.logger.info("getUserProfile called with data:", data, {authedUser: context.auth ? context.auth.uid : 'unauthenticated'});

  const { userId, username } = data;

  if (!userId && !username) {
    functions.logger.warn("getUserProfile validation failed: userId or username required.");
    throw new functions.https.HttpsError('invalid-argument', 'You must provide either a userId or a username.');
  }

  let userDoc;
  let foundUserId;

  try {
    if (userId) {
      if (typeof userId !== 'string' || userId.trim() === '') {
        throw new functions.https.HttpsError('invalid-argument', 'Provided userId must be a non-empty string.');
      }
      functions.logger.info(`Fetching profile by userId: ${userId}`);
      userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        functions.logger.warn(`User not found by userId: ${userId}`);
        throw new functions.https.HttpsError('not-found', 'User profile not found.');
      }
      foundUserId = userDoc.id;
    } else if (username) {
      if (typeof username !== 'string' || username.trim() === '') {
        throw new functions.https.HttpsError('invalid-argument', 'Provided username must be a non-empty string.');
      }
      functions.logger.info(`Fetching profile by username: ${username}`);
      const snapshot = await db.collection('users').where('username', '==', username).limit(1).get();
      if (snapshot.empty) {
        functions.logger.warn(`User not found by username: ${username}`);
        throw new functions.https.HttpsError('not-found', 'User profile not found.');
      }
      userDoc = snapshot.docs[0];
      foundUserId = userDoc.id;
    }
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error; // Re-throw HttpsError
    }
    functions.logger.error("Error fetching user profile:", error, {userId, username});
    throw new functions.https.HttpsError('internal', 'An unexpected error occurred while fetching the user profile.');
  }

  const profileData = userDoc.data();
  const isOwner = context.auth && context.auth.uid === foundUserId;

  if (isOwner) {
    functions.logger.info(`Returning full profile for owner: ${foundUserId}`);
    return { ...profileData, uid: foundUserId }; // Include UID for owner
  } else {
    functions.logger.info(`Returning public profile for: ${foundUserId}, requester: ${context.auth ? context.auth.uid : 'unauthenticated'}`);
    const publicProfileData = {
      uid: foundUserId, // Include UID for public profiles as well
      username: profileData.username,
      displayName: profileData.displayName,
      profilePictureUrl: profileData.profilePictureUrl,
      bio: profileData.bio,
      followersCount: profileData.followersCount,
      followingCount: profileData.followingCount,
      postsCount: profileData.postsCount,
      dateJoined: profileData.dateJoined,
      // Ensure privacySettings is not exposed
    };
    return publicProfileData;
  }
});
