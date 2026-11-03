// Copy the Firebase web app config from Firebase Console > Project settings > Your apps.
// The web config is public by design; protect data with Authentication and Firestore Rules.
export const firebaseConfig = {
  apiKey: "AIzaSyCTchiKth-j6hLBuKNIDRTOXoZfEQi5EaM",
  authDomain: "hsbc-27267.firebaseapp.com",
  projectId: "hsbc-27267",
  appId: "1:177907616041:web:8cecbd47225c1333d84f38"
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  value => typeof value === "string" && value.length > 0 && !value.startsWith("REPLACE_")
);
