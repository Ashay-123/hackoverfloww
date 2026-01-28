// Redirect helper
function redirectByRole(user) {
    if (!user || !user.role) return;
    if (user.role === "participant") {
        window.location.href = "/student-home";
    } else if (user.role === "organizer") {
        window.location.href = "/organizer-home";
    } else if (user.role === "admin") {
        window.location.href = "/admin-home";
    } else {
        window.location.href = "/student-home";
    }
}

// Handle login form submission
function handleLogin(event) {
    event.preventDefault();
    
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const messageDiv = document.getElementById("message");
    const btnText = document.getElementById("btnText");
    const btnLoader = document.getElementById("btnLoader");
    const loginBtn = document.querySelector(".login-btn");
    
    // Clear previous messages
    messageDiv.className = "message";
    messageDiv.textContent = "";
    messageDiv.style.display = "none";
    
    // Show loading state
    loginBtn.disabled = true;
    btnText.style.display = "none";
    btnLoader.style.display = "block";
    
    // Send login request
    fetch("/login", {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
    })
    .then(res => res.json())
    .then(data => {
        // Reset button state
        loginBtn.disabled = false;
        btnText.style.display = "block";
        btnLoader.style.display = "none";
        
        if (data.success) {
            // Show success message
            messageDiv.className = "message success";
            messageDiv.textContent = data.message;
            messageDiv.style.display = "block";
            
            // Store user data in sessionStorage
            sessionStorage.setItem("user", JSON.stringify(data.user));
            
            // Redirect by role
            setTimeout(() => {
                redirectByRole(data.user);
            }, 1000);
        } else {
            // Show error message
            messageDiv.className = "message error";
            messageDiv.textContent = data.message || "Login failed. Please try again.";
            messageDiv.style.display = "block";
        }
    })
    .catch(error => {
        // Reset button state
        loginBtn.disabled = false;
        btnText.style.display = "block";
        btnLoader.style.display = "none";
        
        // Show error message
        messageDiv.className = "message error";
        messageDiv.textContent = "Server error. Please make sure the server is running.";
        messageDiv.style.display = "block";
        console.error("Login error:", error);
    });
}

// Toggle between login and sign-up forms
function toggleForm(event) {
    event.preventDefault();
    
    const loginForm = document.getElementById("loginForm");
    const signupForm = document.getElementById("signupForm");
    const otpForm = document.getElementById("otpForm");
    const headerTitle = document.getElementById("headerTitle");
    const headerSubtitle = document.getElementById("headerSubtitle");
    const toggleText = document.getElementById("toggleText");
    const messageDiv = document.getElementById("message");
    const signupMessageDiv = document.getElementById("signupMessage");
    const otpMessageDiv = document.getElementById("otpMessage");
    
    // Clear messages
    messageDiv.style.display = "none";
    signupMessageDiv.style.display = "none";
    if (otpMessageDiv) otpMessageDiv.style.display = "none";
    
    if (loginForm.style.display === "none") {
        // Show login form
        loginForm.style.display = "block";
        signupForm.style.display = "none";
        if (otpForm) otpForm.style.display = "none";
        headerTitle.textContent = "Welcome Back";
        headerSubtitle.textContent = "Sign in to your account";
        toggleText.innerHTML = 'Don\'t have an account? <a href="#" onclick="toggleForm(event)">Sign up</a>';
    } else {
        // Show sign-up form
        loginForm.style.display = "none";
        signupForm.style.display = "block";
        if (otpForm) otpForm.style.display = "none";
        headerTitle.textContent = "Create Account";
        headerSubtitle.textContent = "Sign up to get started";
        toggleText.innerHTML = 'Already have an account? <a href="#" onclick="toggleForm(event)">Sign in</a>';
    }
}

function toggleOtp(event) {
    event.preventDefault();
    const loginForm = document.getElementById("loginForm");
    const signupForm = document.getElementById("signupForm");
    const otpForm = document.getElementById("otpForm");
    const headerTitle = document.getElementById("headerTitle");
    const headerSubtitle = document.getElementById("headerSubtitle");
    if (!otpForm) return;

    const isOtpVisible = otpForm.style.display === "block";
    if (isOtpVisible) {
        otpForm.style.display = "none";
        loginForm.style.display = "block";
        signupForm.style.display = "none";
        headerTitle.textContent = "Welcome Back";
        headerSubtitle.textContent = "Sign in to your account";
    } else {
        otpForm.style.display = "block";
        loginForm.style.display = "none";
        signupForm.style.display = "none";
        headerTitle.textContent = "OTP Login";
        headerSubtitle.textContent = "Sign in with a one-time code";
    }
}

function requestOtp(event) {
    if (event) event.preventDefault();
    const email = document.getElementById("otpEmail").value.trim();
    const otpMessage = document.getElementById("otpMessage");
    if (!email) {
        otpMessage.className = "message error";
        otpMessage.textContent = "Enter your email to request an OTP.";
        otpMessage.style.display = "block";
        return;
    }
    otpMessage.className = "message";
    otpMessage.textContent = "";
    otpMessage.style.display = "none";

    fetch("/auth/request-otp", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
    })
    .then(res => res.json())
    .then(data => {
        otpMessage.className = data.success ? "message success" : "message error";
        otpMessage.textContent = data.message || (data.success ? "OTP sent" : "Failed to send OTP");
        otpMessage.style.display = "block";
        if (data.otp) {
            document.getElementById("otpCode").value = data.otp;
        }
    })
    .catch(err => {
        otpMessage.className = "message error";
        otpMessage.textContent = "Server error. Please try again.";
        otpMessage.style.display = "block";
        console.error("OTP request error:", err);
    });
}

function handleOtpVerify(event) {
    event.preventDefault();
    const email = document.getElementById("otpEmail").value.trim();
    const code = document.getElementById("otpCode").value.trim();
    const otpMessage = document.getElementById("otpMessage");
    if (!email || !code) {
        otpMessage.className = "message error";
        otpMessage.textContent = "Enter email and OTP code.";
        otpMessage.style.display = "block";
        return;
    }

    fetch("/auth/verify-otp", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            otpMessage.className = "message success";
            otpMessage.textContent = data.message || "OTP verified";
            otpMessage.style.display = "block";
            sessionStorage.setItem("user", JSON.stringify(data.user));
            setTimeout(() => redirectByRole(data.user), 800);
        } else {
            otpMessage.className = "message error";
            otpMessage.textContent = data.message || "OTP verification failed";
            otpMessage.style.display = "block";
        }
    })
    .catch(err => {
        otpMessage.className = "message error";
        otpMessage.textContent = "Server error. Please try again.";
        otpMessage.style.display = "block";
        console.error("OTP verify error:", err);
    });
}

// Handle sign-up form submission
function handleSignup(event) {
    event.preventDefault();
    
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const role = document.getElementById("userRole").value;
    const messageDiv = document.getElementById("signupMessage");
    const btnText = document.getElementById("signupBtnText");
    const btnLoader = document.getElementById("signupBtnLoader");
    const signupForm = document.getElementById("signupForm");
    const signupBtn = signupForm.querySelector(".login-btn");
    
    // Clear previous messages
    messageDiv.className = "message";
    messageDiv.textContent = "";
    messageDiv.style.display = "none";
    
    // Validate passwords match
    if (password !== confirmPassword) {
        messageDiv.className = "message error";
        messageDiv.textContent = "Passwords do not match";
        messageDiv.style.display = "block";
        return;
    }
    
    // Validate password length
    if (password.length < 6) {
        messageDiv.className = "message error";
        messageDiv.textContent = "Password must be at least 6 characters long";
        messageDiv.style.display = "block";
        return;
    }
    
    // Validate role
    if (!role) {
        messageDiv.className = "message error";
        messageDiv.textContent = "Please select a role";
        messageDiv.style.display = "block";
        return;
    }
    
    // Show loading state
    signupBtn.disabled = true;
    btnText.style.display = "none";
    btnLoader.style.display = "block";
    
    // Send sign-up request
    fetch("/register", {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password, role })
    })
    .then(res => res.json())
    .then(data => {
        // Reset button state
        signupBtn.disabled = false;
        btnText.style.display = "block";
        btnLoader.style.display = "none";
        
        if (data.success) {
            // Show success message
            messageDiv.className = "message success";
            messageDiv.textContent = data.message;
            messageDiv.style.display = "block";
            
            // Store user data in sessionStorage
            sessionStorage.setItem("user", JSON.stringify(data.user));
            
            // Redirect by role
            setTimeout(() => {
                redirectByRole(data.user);
            }, 1000);
        } else {
            // Show error message
            messageDiv.className = "message error";
            messageDiv.textContent = data.message || "Registration failed. Please try again.";
            messageDiv.style.display = "block";
        }
    })
    .catch(error => {
        // Reset button state
        signupBtn.disabled = false;
        btnText.style.display = "block";
        btnLoader.style.display = "none";
        
        // Show error message
        messageDiv.className = "message error";
        messageDiv.textContent = "Server error. Please make sure the server is running.";
        messageDiv.style.display = "block";
        console.error("Sign-up error:", error);
    });
}

// Check if user is already logged in on page load
window.addEventListener("DOMContentLoaded", () => {
    const userData = sessionStorage.getItem("user");
    if (userData) {
        try {
            const user = JSON.parse(userData);
            redirectByRole(user);
        } catch (error) {
            console.error("Error parsing user data:", error);
            sessionStorage.removeItem("user");
        }
    }
});
