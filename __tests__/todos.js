process.env.NODE_ENV = "test";
const request = require("supertest");
const bcrypt = require("bcrypt");
const app = require("../app");
const db = require("../models");

beforeAll(async () => {
    await db.sequelize.sync({ force: true });
});

afterAll(async () => {
    await db.sequelize.close();
});

describe("Todo Application Test Suite", () => {
    let user1Agent;
    let user2Agent;

    test("Core Req 5 & Security: Signup requires first_name, valid email, and hashes password", async () => {
        // Missing first_name
        const resMissingName = await request(app)
            .post("/signup")
            .send({
                firstName: "",
                email: "test1@example.com",
                password: "password123"
            });
        expect(resMissingName.status).toBe(302);
        expect(resMissingName.header.location).toBe("/signup");

        // Invalid email
        const resInvalidEmail = await request(app)
            .post("/signup")
            .send({
                firstName: "John",
                email: "invalid-email",
                password: "password123"
            });
        expect(resInvalidEmail.status).toBe(302);
        expect(resInvalidEmail.header.location).toBe("/signup");

        // Password too short
        const resShortPass = await request(app)
            .post("/signup")
            .send({
                firstName: "John",
                email: "valid@example.com",
                password: "12"
            });
        expect(resShortPass.status).toBe(302);
        expect(resShortPass.header.location).toBe("/signup");

        // Successful signup
        user1Agent = request.agent(app);
        const resSuccess = await user1Agent
            .post("/signup")
            .send({
                firstName: "Alice",
                email: "alice@example.com",
                password: "securepassword123"
            });
        expect(resSuccess.status).toBe(302);
        expect(resSuccess.header.location).toBe("/todos");

        // Verify password was hashed with bcrypt in database
        const userInDb = await db.User.findOne({ where: { email: "alice@example.com" } });
        expect(userInDb).not.toBeNull();
        expect(userInDb.password).not.toBe("securepassword123");
        expect(userInDb.password.startsWith("$2b$") || userInDb.password.startsWith("$2a$")).toBe(true);
        const match = await bcrypt.compare("securepassword123", userInDb.password);
        expect(match).toBe(true);
    });

    test("Core Req 5: Duplicate email signup is blocked with flash redirect", async () => {
        const resDup = await request(app)
            .post("/signup")
            .send({
                firstName: "Another Alice",
                email: "alice@example.com",
                password: "password123"
            });
        expect(resDup.status).toBe(302);
        expect(resDup.header.location).toBe("/signup");
    });

    test("Core Req 3: Invalid login attempt flashes message and redirects back to /login", async () => {
        const agent = request.agent(app);

        // Empty credentials
        const resEmpty = await agent
            .post("/login")
            .send({
                email: "",
                password: ""
            });
        expect(resEmpty.status).toBe(302);
        expect(resEmpty.header.location).toBe("/login");

        // Wrong password
        const resWrongPass = await agent
            .post("/login")
            .send({
                email: "alice@example.com",
                password: "wrongpassword"
            });
        expect(resWrongPass.status).toBe(302);
        expect(resWrongPass.header.location).toBe("/login");

        // Non-existent email
        const resNoUser = await agent
            .post("/login")
            .send({
                email: "nonexistent@example.com",
                password: "password123"
            });
        expect(resNoUser.status).toBe(302);
        expect(resNoUser.header.location).toBe("/login");
    });

    test("Core Req 4: Creating a todo with blank title or missing dueDate is blocked with validation error", async () => {
        // Blank title
        const resBlankTitle = await user1Agent
            .post("/todos")
            .send({
                title: "",
                dueDate: "2026-10-01",
                description: "Test todo"
            });
        expect(resBlankTitle.status).toBe(302);
        expect(resBlankTitle.header.location).toBe("/todo");

        // Missing dueDate
        const resMissingDueDate = await user1Agent
            .post("/todos")
            .send({
                title: "Valid Title",
                dueDate: "",
                description: "Test todo"
            });
        expect(resMissingDueDate.status).toBe(302);
        expect(resMissingDueDate.header.location).toBe("/todo");

        // Valid todo creation
        const resValid = await user1Agent
            .post("/todos")
            .send({
                title: "Alice's First Todo",
                dueDate: "2026-10-01",
                description: "Secret notes"
            });
        expect(resValid.status).toBe(302);
        expect(resValid.header.location).toBe("/todos");

        // Verify in DB
        const createdTodo = await db.Todo.findOne({ where: { title: "Alice's First Todo" } });
        expect(createdTodo).not.toBeNull();
        expect(createdTodo.dueDate).toBe("2026-10-01");
    });

    test("Core Req 4: Updating todo with blank title is blocked with validation error", async () => {
        const todo = await db.Todo.findOne({ where: { title: "Alice's First Todo" } });
        expect(todo).not.toBeNull();

        const resBlankUpdate = await user1Agent
            .post(`/edit-todo/${todo.id}`)
            .send({
                title: "",
                dueDate: "2026-10-01"
            });
        expect(resBlankUpdate.status).toBe(302);
        expect(resBlankUpdate.header.location).toBe(`/edit-todo/${todo.id}`);

        const verifyUnchanged = await db.Todo.findByPk(todo.id);
        expect(verifyUnchanged.title).toBe("Alice's First Todo");
    });

    test("Core Req 2 & Security: Strict per-user isolation at database query level", async () => {
        // Find Alice's todo
        const aliceUser = await db.User.findOne({ where: { email: "alice@example.com" } });
        const aliceTodo = await db.Todo.findOne({ where: { userId: aliceUser.id } });
        expect(aliceTodo).not.toBeNull();

        // Sign up second user (Bob)
        user2Agent = request.agent(app);
        const bobSignup = await user2Agent
            .post("/signup")
            .send({
                firstName: "Bob",
                email: "bob@example.com",
                password: "bobpassword123"
            });
        expect(bobSignup.status).toBe(302);

        // 1. Bob views /todos -> Alice's todo must NOT appear
        const bobTodosPage = await user2Agent.get("/todos");
        expect(bobTodosPage.status).toBe(200);
        expect(bobTodosPage.text).not.toContain("Alice's First Todo");

        // 2. Bob attempts to edit Alice's todo -> blocked/redirected
        const bobEditAttempt = await user2Agent.get(`/edit-todo/${aliceTodo.id}`);
        expect(bobEditAttempt.status).toBe(302);
        expect(bobEditAttempt.header.location).toBe("/todos");

        // 3. Bob attempts to update Alice's todo -> blocked
        const bobUpdateAttempt = await user2Agent
            .post(`/edit-todo/${aliceTodo.id}`)
            .send({
                title: "Hacked by Bob",
                dueDate: "2026-10-01"
            });
        expect(bobUpdateAttempt.status).toBe(302);
        const verifyUntouched = await db.Todo.findByPk(aliceTodo.id);
        expect(verifyUntouched.title).toBe("Alice's First Todo");

        // 4. Bob attempts to complete Alice's todo -> blocked
        await user2Agent.post(`/todos/${aliceTodo.id}/complete`);
        const verifyUncompleted = await db.Todo.findByPk(aliceTodo.id);
        expect(verifyUncompleted.completed).toBe(false);

        // 5. Bob attempts to delete Alice's todo -> blocked
        await user2Agent.post(`/todos/${aliceTodo.id}/delete`);
        const verifyStillExists = await db.Todo.findByPk(aliceTodo.id);
        expect(verifyStillExists).not.toBeNull();

        // 6. Alice can manage her own todo
        await user1Agent.post(`/todos/${aliceTodo.id}/complete`);
        const aliceCompleted = await db.Todo.findByPk(aliceTodo.id);
        expect(aliceCompleted.completed).toBe(true);

        await user1Agent.post(`/todos/${aliceTodo.id}/delete`);
        const aliceDeleted = await db.Todo.findByPk(aliceTodo.id);
        expect(aliceDeleted).toBeNull();
    });

    test("Core Req 1: Sign out clears session and prevents access to protected routes", async () => {
        // Logout Alice
        const logoutRes = await user1Agent.post("/logout");
        expect(logoutRes.status).toBe(302);
        expect(logoutRes.header.location).toBe("/");

        // Accessing /todos after logout redirects to /login
        const protectedRes = await user1Agent.get("/todos");
        expect(protectedRes.status).toBe(302);
        expect(protectedRes.header.location).toBe("/login");
    });
});
