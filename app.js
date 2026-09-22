const express = require("express");
const path = require("path");
const session = require("express-session");
const flash = require("connect-flash");
const bcrypt = require("bcrypt");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
require("dotenv").config();

const { Todo, User, sequelize } = require("./models");

const app = express();

// Trust proxy for secure cookies behind reverse proxies like Render
app.set("trust proxy", 1);

// =====================================
// BASIC EXPRESS SETTINGS
// =====================================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// =====================================
// MIDDLEWARE
// =====================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// =====================================
// SESSION STORE
// In production or when DATABASE_URL is set, use connect-pg-simple
// =====================================
const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";
let sessionStore = null;

if (!isTest && (isProduction || process.env.DATABASE_URL)) {
    try {
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        sessionStore = new pgSession({
            pool,
            tableName: "session",
            createTableIfMissing: true
        });
        sessionStore.on("error", (err) => {
            console.warn("Session store error:", err.message);
        });
    } catch (err) {
        console.warn("Failed to initialize PostgreSQL session store:", err.message);
    }
} else if (!isTest && process.env.USE_PG_SESSION === "true") {
    try {
        const pool = new Pool({
            user: process.env.DB_USERNAME || "postgres",
            password: process.env.DB_PASSWORD || "",
            host: process.env.DB_HOST || "127.0.0.1",
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || "todo_app"
        });
        sessionStore = new pgSession({
            pool,
            tableName: "session",
            createTableIfMissing: true
        });
        sessionStore.on("error", (err) => {
            console.warn("Session store error:", err.message);
        });
    } catch (err) {
        console.warn("Failed to initialize local PostgreSQL session store:", err.message);
    }
}

const sessionSecret = process.env.SESSION_SECRET || "todo_app_local_session_secret";

const sessionConfig = {
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        secure: isProduction
    }
};

if (sessionStore) {
    sessionConfig.store = sessionStore;
}

app.use(session(sessionConfig));

// =====================================
// FLASH MESSAGES
// =====================================
app.use(flash());

// =====================================
// MAKE SESSION USER & FLASH AVAILABLE IN EJS
// =====================================
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;

    const flashSuccess = req.flash("success") || [];
    const flashError = req.flash("error") || [];

    res.locals.success = flashSuccess;
    res.locals.error = flashError;
    res.locals.errors = flashError;
    res.locals.messages = flashSuccess;

    next();
});

// =====================================
// AUTHENTICATION GUARDS
// =====================================
const ensureLoggedIn = (req, res, next) => {
    if (!req.session || !req.session.user) {
        req.flash("error", "You must be logged in to access this page.");
        return res.redirect("/login");
    }
    next();
};

const redirectIfLoggedIn = (req, res, next) => {
    if (req.session && req.session.user) {
        return res.redirect("/todos");
    }
    next();
};

// =====================================
// HOME & AUTH ROUTES
// =====================================

// Home Page
app.get("/", (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect("/todos");
    }
    res.render("index");
});

// Signup Page
app.get("/signup", redirectIfLoggedIn, (req, res) => {
    res.render("signup");
});

// Signup Handler
app.post("/signup", redirectIfLoggedIn, async (req, res) => {
    const { firstName, first_name, lastName, last_name, username, email, password } = req.body;
    const fName = firstName || first_name || username;
    const lName = lastName || last_name || null;

    // Server-side password validation
    if (!password || password.trim().length === 0) {
        req.flash("error", "Password is required");
        return res.redirect("/signup");
    }

    if (password.length < 4) {
        req.flash("error", "Password must be at least 4 characters long");
        return res.redirect("/signup");
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            firstName: fName,
            lastName: lName,
            username: username || fName,
            email,
            password: hashedPassword
        });

        // Set session user
        req.session.user = {
            id: user.id,
            firstName: user.firstName,
            email: user.email
        };

        req.flash("success", "Account created successfully!");
        return res.redirect("/todos");
    } catch (error) {
        if (error.name === "SequelizeValidationError" || error.name === "SequelizeUniqueConstraintError") {
            error.errors.forEach((e) => {
                req.flash("error", e.message);
            });
        } else {
            req.flash("error", "Signup failed: " + error.message);
        }
        return res.redirect("/signup");
    }
});

// Login Page
app.get("/login", redirectIfLoggedIn, (req, res) => {
    res.render("login");
});

// Login Handler
app.post("/login", redirectIfLoggedIn, async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        req.flash("error", "Please provide both email and password.");
        return res.redirect("/login");
    }

    try {
        const user = await User.findOne({ where: { email } });

        if (!user) {
            req.flash("error", "Invalid email or password.");
            return res.redirect("/login");
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            req.flash("error", "Invalid email or password.");
            return res.redirect("/login");
        }

        // Establish session
        req.session.user = {
            id: user.id,
            firstName: user.firstName || user.username,
            email: user.email
        };

        return res.redirect("/todos");
    } catch (error) {
        req.flash("error", "An unexpected error occurred during login. Please try again.");
        return res.redirect("/login");
    }
});

// Logout Handlers
const handleLogout = (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
        }
        res.clearCookie("connect.sid");
        res.redirect("/");
    });
};

app.post("/logout", handleLogout);
app.get("/logout", handleLogout);
app.get("/signout", handleLogout);

// =====================================
// TODO ROUTES (Strictly Scoped by userId)
// =====================================

// List all todos for the logged-in user
app.get("/todos", ensureLoggedIn, async (req, res) => {
    try {
        const todos = await Todo.findAll({
            where: { userId: req.session.user.id },
            order: [
                ["dueDate", "ASC"],
                ["id", "ASC"]
            ]
        });

        if (req.accepts("html")) {
            return res.render("todos", { todos });
        }
        return res.json(todos);
    } catch (error) {
        console.error("Error fetching todos:", error);
        req.flash("error", "Failed to load todos.");
        return res.redirect("/");
    }
});

// Create Todo Page
app.get("/todo", ensureLoggedIn, (req, res) => {
    res.render("todo");
});

// Create Todo Handler
app.post("/todos", ensureLoggedIn, async (req, res) => {
    const body = req.body || {};
    const { title, description, dueDate, due_date } = body;
    const finalDueDate = dueDate || due_date;

    try {
        const todo = await Todo.create({
            title: title ? title.trim() : title,
            description: description ? description.trim() : null,
            dueDate: finalDueDate ? finalDueDate : null,
            completed: false,
            userId: req.session.user.id
        });

        if (req.accepts("html")) {
            req.flash("success", "Todo added successfully!");
            return res.redirect("/todos");
        }
        return res.status(201).json(todo);
    } catch (error) {
        if (error.name === "SequelizeValidationError") {
            error.errors.forEach((e) => {
                req.flash("error", e.message);
            });
        } else {
            req.flash("error", "Failed to create todo: " + error.message);
        }

        if (req.accepts("html")) {
            return res.redirect("/todo");
        }
        return res.status(422).json({ error: error.message });
    }
});

// Edit Todo Page
app.get("/edit-todo/:id", ensureLoggedIn, async (req, res) => {
    try {
        const todo = await Todo.findOne({
            where: {
                id: req.params.id,
                userId: req.session.user.id
            }
        });

        if (!todo) {
            req.flash("error", "Todo not found or unauthorized.");
            return res.redirect("/todos");
        }

        res.render("edit-todo", { todo });
    } catch (error) {
        req.flash("error", "Failed to retrieve todo.");
        res.redirect("/todos");
    }
});

// Update Todo Handler
const handleUpdateTodo = async (req, res) => {
    try {
        const todo = await Todo.findOne({
            where: {
                id: req.params.id,
                userId: req.session.user.id
            }
        });

        if (!todo) {
            if (req.accepts("html")) {
                req.flash("error", "Todo not found or unauthorized.");
                return res.redirect("/todos");
            }
            return res.status(404).json({ error: "Todo not found" });
        }

        const body = req.body || {};
        const { title, description, dueDate, due_date, completed } = body;
        const finalDueDate = dueDate || due_date || todo.dueDate;

        let isCompleted = todo.completed;
        if (completed !== undefined) {
            isCompleted = completed === true || completed === "true" || completed === "on";
        }

        await todo.update({
            title: title !== undefined ? (title ? title.trim() : title) : todo.title,
            description: description !== undefined ? description : todo.description,
            dueDate: finalDueDate,
            completed: isCompleted
        });

        if (req.accepts("html")) {
            req.flash("success", "Todo updated successfully!");
            return res.redirect("/todos");
        }
        return res.json(todo);
    } catch (error) {
        if (error.name === "SequelizeValidationError") {
            error.errors.forEach((e) => {
                req.flash("error", e.message);
            });
        } else {
            req.flash("error", "Failed to update todo: " + error.message);
        }

        if (req.accepts("html")) {
            return res.redirect(`/edit-todo/${req.params.id}`);
        }
        return res.status(422).json({ error: error.message });
    }
};

app.post("/edit-todo/:id", ensureLoggedIn, handleUpdateTodo);
app.put("/todos/:id", ensureLoggedIn, handleUpdateTodo);

// Toggle Complete Handler
const handleToggleComplete = async (req, res) => {
    try {
        const todo = await Todo.findOne({
            where: {
                id: req.params.id,
                userId: req.session.user.id
            }
        });

        if (!todo) {
            if (req.accepts("html")) {
                req.flash("error", "Todo not found or unauthorized.");
                return res.redirect("/todos");
            }
            return res.status(404).json({ error: "Todo not found" });
        }

        const body = req.body || {};
        const newStatus = body.completed !== undefined
            ? (body.completed === true || body.completed === "true")
            : !todo.completed;

        await todo.update({ completed: newStatus });

        if (req.accepts("html")) {
            return res.redirect("/todos");
        }
        return res.json(todo);
    } catch (error) {
        if (req.accepts("html")) {
            req.flash("error", "Failed to toggle todo status.");
            return res.redirect("/todos");
        }
        return res.status(500).json({ error: error.message });
    }
};

app.post("/todos/:id/complete", ensureLoggedIn, handleToggleComplete);
app.put("/todos/:id/markAsCompleted", ensureLoggedIn, async (req, res) => {
    req.body.completed = true;
    return handleToggleComplete(req, res);
});
app.put("/todos/:id/markAsIncomplete", ensureLoggedIn, async (req, res) => {
    req.body.completed = false;
    return handleToggleComplete(req, res);
});

// Delete Todo Handler
const handleDeleteTodo = async (req, res) => {
    try {
        const todo = await Todo.findOne({
            where: {
                id: req.params.id,
                userId: req.session.user.id
            }
        });

        if (!todo) {
            if (req.accepts("html")) {
                req.flash("error", "Todo not found or unauthorized.");
                return res.redirect("/todos");
            }
            return res.status(404).json({ error: "Todo not found" });
        }

        await todo.destroy();

        if (req.accepts("html")) {
            req.flash("success", "Todo deleted successfully!");
            return res.redirect("/todos");
        }
        return res.json({ success: true });
    } catch (error) {
        if (req.accepts("html")) {
            req.flash("error", "Failed to delete todo.");
            return res.redirect("/todos");
        }
        return res.status(500).json({ error: error.message });
    }
};

app.post("/todos/:id/delete", ensureLoggedIn, handleDeleteTodo);
app.delete("/todos/:id", ensureLoggedIn, handleDeleteTodo);

// Export app for tests and external servers
module.exports = app;

// If started directly via `node app.js`
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    sequelize
        .authenticate()
        .then(() => {
            console.log("Database connected successfully!");
            app.listen(PORT, () => {
                console.log(`Server running at http://localhost:${PORT}`);
            });
        })
        .catch((error) => {
            console.error("Database connection failed:", error);
        });
}