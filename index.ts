import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

// Ensure global variables are defined, providing fallbacks for local development
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

function App() {
  // Initial page depends on whether user is logged in. Default to 'landing' if not.
  const [currentPage, setCurrentPage] = useState('landing'); // 'landing', 'home', 'login', 'register', 'new-post'
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null);
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [storage, setStorage] = useState(null);
  const [authReady, setAuthReady] = useState(false); // To ensure Firebase auth is ready before Firestore operations

  // Initialize Firebase and set up auth listener
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);
      const firebaseStorage = getStorage(app);

      setDb(firestoreDb);
      setAuth(firebaseAuth);
      setStorage(firebaseStorage);

      // Listen for authentication state changes
      const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          setUserId(currentUser.uid);
          // If user is logged in, redirect to home page
          setCurrentPage('home');
        } else {
          // If no user, try to sign in with custom token or anonymously
          if (initialAuthToken) {
            try {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } catch (error) {
              console.error("Error signing in with custom token:", error);
              await signInAnonymously(firebaseAuth); // Fallback to anonymous
            }
          } else {
            await signInAnonymously(firebaseAuth); // Sign in anonymously if no token
          }
          // If still no user after attempts, stay on landing page
          if (!currentUser) setCurrentPage('landing');
        }
        setAuthReady(true); // Mark auth as ready
      });

      return () => unsubscribe(); // Cleanup auth listener on unmount
    } catch (error) {
      console.error("Failed to initialize Firebase:", error);
    }
  }, []);

  // Component to display messages (e.g., success, error)
  const MessageBox = ({ message, type, onClose }) => {
    if (!message) return null;
    const bgColor = type === 'error' ? 'bg-red-500' : 'bg-green-500';
    return (
      <div className={`${bgColor} text-white p-4 rounded-lg shadow-lg mb-4 flex justify-between items-center`}>
        <span>{message}</span>
        <button onClick={onClose} className="text-white font-bold text-xl leading-none">&times;</button>
      </div>
    );
  };

  // Login/Register Form Component
  const AuthForm = ({ auth, onAuthSuccess, setCurrentPage }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState('');
    const [isLogin, setIsLogin] = useState(true);

    const handleSubmit = async (e) => {
      e.preventDefault();
      setMessage('');
      try {
        if (isLogin) {
          await signInWithEmailAndPassword(auth, email, password);
          setMessage('Logged in successfully!');
          setMessageType('success');
        } else {
          await createUserWithEmailAndPassword(auth, email, password);
          setMessage('Account created successfully! You are now logged in.');
          setMessageType('success');
        }
        onAuthSuccess(); // Callback to parent to update user state
      } catch (error) {
        console.error("Authentication error:", error);
        setMessage(error.message);
        setMessageType('error');
      }
    };

    return (
      <div className="max-w-md mx-auto p-6 bg-gray-800 rounded-xl shadow-lg mt-8">
        <h2 className="text-2xl font-bold text-white mb-6 text-center">{isLogin ? 'Login' : 'Register'}</h2>
        <MessageBox message={message} type={messageType} onClose={() => setMessage('')} />
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-gray-300 text-sm font-bold mb-2">Email:</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 border-gray-600 text-white"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-gray-300 text-sm font-bold mb-2">Password:</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 border-gray-600 text-white"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline transition duration-200"
          >
            {isLogin ? 'Login' : 'Register'}
          </button>
        </form>
        <div className="mt-6 text-center">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            {isLogin ? 'Need an account? Register' : 'Already have an account? Login'}
          </button>
        </div>
      </div>
    );
  };

  // New Post Form Component
  const NewPostForm = ({ db, storage, user, setCurrentPage }) => {
    const [text, setText] = useState('');
    const [imageFile, setImageFile] = useState(null);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState('');
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef(null);

    const handleImageChange = (e) => {
      if (e.target.files[0]) {
        setImageFile(e.target.files[0]);
      }
    };

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (!user) {
        setMessage('You must be logged in to create a post.');
        setMessageType('error');
        return;
      }
      if (!text.trim() && !imageFile) {
        setMessage('Please enter some text or select an image.');
        setMessageType('error');
        return;
      }

      setUploading(true);
      setMessage('');
      let imageUrl = null;

      try {
        if (imageFile) {
          const storageRef = ref(storage, `posts/${user.uid}/${Date.now()}_${imageFile.name}`);
          const uploadTask = uploadBytesResumable(storageRef, imageFile);

          await new Promise((resolve, reject) => {
            uploadTask.on('state_changed',
              (snapshot) => {
                // Optional: handle progress
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                setMessage(`Upload is ${progress.toFixed(0)}% done`);
                setMessageType('success');
              },
              (error) => {
                console.error("Image upload error:", error);
                setMessage('Image upload failed: ' + error.message);
                setMessageType('error');
                setUploading(false);
                reject(error);
              },
              async () => {
                imageUrl = await getDownloadURL(uploadTask.snapshot.ref);
                resolve();
              }
            );
          });
        }

        await addDoc(collection(db, `artifacts/${appId}/public/data/posts`), {
          text: text.trim(),
          imageUrl: imageUrl,
          authorId: user.uid,
          authorEmail: user.email || 'Anonymous',
          timestamp: serverTimestamp(),
        });

        setMessage('Post created successfully!');
        setMessageType('success');
        setText('');
        setImageFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = ''; // Clear file input
        }
        setCurrentPage('home'); // Redirect to home after successful post
      } catch (error) {
        console.error("Error creating post:", error);
        setMessage('Failed to create post: ' + error.message);
        setMessageType('error');
      } finally {
        setUploading(false);
      }
    };

    return (
      <div className="max-w-xl mx-auto p-6 bg-gray-800 rounded-xl shadow-lg mt-8">
        <h2 className="text-2xl font-bold text-white mb-6 text-center">Create New Post</h2>
        <MessageBox message={message} type={messageType} onClose={() => setMessage('')} />
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="postText" className="block text-gray-300 text-sm font-bold mb-2">What's happening?</label>
            <textarea
              id="postText"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows="4"
              className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 border-gray-600 text-white"
              placeholder="Share news, events, or alerts..."
            ></textarea>
          </div>
          <div>
            <label htmlFor="postImage" className="block text-gray-300 text-sm font-bold mb-2">Add an image (optional):</label>
            <input
              type="file"
              id="postImage"
              ref={fileInputRef}
              onChange={handleImageChange}
              accept="image/*"
              className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600"
            />
            {imageFile && (
              <p className="text-gray-400 text-xs mt-2">Selected: {imageFile.name}</p>
            )}
          </div>
          <button
            type="submit"
            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline transition duration-200 flex items-center justify-center"
            disabled={uploading}
          >
            {uploading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Posting...
              </>
            ) : 'Post Update'}
          </button>
        </form>
      </div>
    );
  };

  // Post List Component
  const PostList = ({ db, user }) => {
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState('');

    useEffect(() => {
      if (!db || !authReady) { // Ensure db and auth are ready
        return;
      }

      const postsCollectionRef = collection(db, `artifacts/${appId}/public/data/posts`);
      // Note: orderBy is commented out as per instructions to avoid index issues,
      // but in a real app, you'd typically order by timestamp.
      const q = query(postsCollectionRef); // , orderBy('timestamp', 'desc'));

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedPosts = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          // Convert Firebase Timestamp to JS Date for display
          timestamp: doc.data().timestamp ? doc.data().timestamp.toDate() : null
        }));
        // Sort in memory if orderBy is not used in query
        fetchedPosts.sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0));
        setPosts(fetchedPosts);
        setLoading(false);
      }, (error) => {
        console.error("Error fetching posts:", error);
        setMessage('Failed to load posts: ' + error.message);
        setMessageType('error');
        setLoading(false);
      });

      return () => unsubscribe(); // Cleanup listener
    }, [db, authReady]); // Re-run effect if db or authReady changes

    const handleDelete = async (postId, postAuthorId) => {
      if (!user || user.uid !== postAuthorId) {
        setMessage('You can only delete your own posts.');
        setMessageType('error');
        return;
      }
      // Using window.confirm for simplicity, replace with custom modal in production
      if (!window.confirm('Are you sure you want to delete this post?')) {
        return;
      }
      try {
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/posts`, postId));
        setMessage('Post deleted successfully!');
        setMessageType('success');
      } catch (error) {
        console.error("Error deleting post:", error);
        setMessage('Failed to delete post: ' + error.message);
        setMessageType('error');
      }
    };

    if (loading) {
      return <div className="text-center text-white mt-8">Loading posts...</div>;
    }

    if (posts.length === 0) {
      return <div className="text-center text-gray-400 mt-8">No posts yet. Be the first to share an update!</div>;
    }

    return (
      <div className="max-w-2xl mx-auto mt-8 space-y-6">
        <MessageBox message={message} type={messageType} onClose={() => setMessage('')} />
        {posts.map((post) => (
          <div key={post.id} className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
            {post.imageUrl && (
              <img
                src={post.imageUrl}
                alt="Post image"
                className="w-full h-64 object-cover rounded-lg mb-4"
                onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/600x400/333/FFF?text=Image+Load+Error'; }}
              />
            )}
            <p className="text-gray-300 text-lg mb-3">{post.text}</p>
            <div className="flex justify-between items-center text-sm text-gray-500">
              <span>Posted by: {post.authorEmail}</span>
              <span>{post.timestamp ? post.timestamp.toLocaleString() : 'Just now'}</span>
              {user && user.uid === post.authorId && (
                <button
                  onClick={() => handleDelete(post.id, post.authorId)}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs py-1 px-3 rounded-lg transition duration-200"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // New Landing Page Component
  const LandingPage = ({ setCurrentPage, user }) => {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-100px)] text-center px-4">
        <h2 className="text-5xl font-extrabold text-white mb-6 leading-tight">
          Discover Your Community's <span className="text-blue-400">Pulse</span>
        </h2>
        <p className="text-xl text-gray-300 mb-10 max-w-2xl">
          Get real-time updates on what's happening around you – from local events and fun gatherings to important safety alerts. Share your own observations and help keep your neighborhood informed!
        </p>
        <div className="space-x-4">
          {user ? (
            <button
              onClick={() => setCurrentPage('home')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition duration-300 transform hover:scale-105"
            >
              Go to Feed
            </button>
          ) : (
            <button
              onClick={() => setCurrentPage('register')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition duration-300 transform hover:scale-105"
            >
              Get Started - Join Now!
            </button>
          )}
          <button
            onClick={() => setCurrentPage('home')} // Or a dedicated 'about' page if you create one
            className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-8 rounded-full shadow-lg transition duration-300 transform hover:scale-105"
          >
            Explore Posts
          </button>
        </div>
        <div className="mt-12 text-gray-400 text-sm">
          <p>&copy; 2025 Local Pulse. All rights reserved.</p>
        </div>
      </div>
    );
  };


  // Main App Render
  return (
    <div className="min-h-screen bg-gray-900 text-white font-inter p-4">
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
          body { font-family: 'Inter', sans-serif; }
        `}
      </style>
      <header className="flex justify-between items-center py-4 px-6 bg-gray-800 rounded-xl shadow-md">
        <h1 className="text-3xl font-bold text-blue-400">Local Pulse</h1>
        <nav className="space-x-4">
          {user && ( // Only show Home button if logged in
            <button onClick={() => setCurrentPage('home')} className="text-white hover:text-blue-400 transition duration-200">Home</button>
          )}
          {user ? (
            <>
              <button onClick={() => setCurrentPage('new-post')} className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg transition duration-200">New Post</button>
              <button onClick={async () => { await signOut(auth); setUser(null); setUserId(null); setCurrentPage('landing'); }} className="bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg transition duration-200">Logout</button>
            </>
          ) : (
            <button onClick={() => setCurrentPage('login')} className="bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg transition duration-200">Login/Register</button>
          )}
        </nav>
      </header>

      <main className="container mx-auto py-8">
        {userId && (
          <p className="text-center text-gray-400 mb-4">
            Current User ID: <span className="font-mono text-sm break-all">{userId}</span>
          </p>
        )}

        {!authReady ? (
          <div className="text-center text-white mt-8">Initializing Firebase...</div>
        ) : (
          <>
            {currentPage === 'landing' && <LandingPage setCurrentPage={setCurrentPage} user={user} />}
            {currentPage === 'home' && db && user && <PostList db={db} user={user} />}
            {currentPage === 'login' && auth && <AuthForm auth={auth} onAuthSuccess={() => setCurrentPage('home')} setCurrentPage={setCurrentPage} />}
            {currentPage === 'register' && auth && <AuthForm auth={auth} onAuthSuccess={() => setCurrentPage('home')} setCurrentPage={setCurrentPage} />}
            {currentPage === 'new-post' && db && storage && user && <NewPostForm db={db} storage={storage} user={user} setCurrentPage={setCurrentPage} />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
