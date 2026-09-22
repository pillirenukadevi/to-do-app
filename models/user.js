const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class User extends Model {
        static associate(models) {
            User.hasMany(models.Todo, {
                foreignKey: "userId",
                as: "todos",
                onDelete: "CASCADE"
            });
        }
    }

    User.init(
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },

            firstName: {
                type: DataTypes.STRING,
                allowNull: false,
                validate: {
                    notNull: { msg: "First name is required" },
                    notEmpty: { msg: "First name cannot be empty" }
                }
            },

            lastName: {
                type: DataTypes.STRING,
                allowNull: true
            },

            username: {
                type: DataTypes.STRING,
                allowNull: true
            },

            first_name: {
                type: DataTypes.VIRTUAL,
                get() {
                    return this.firstName;
                },
                set(value) {
                    this.setDataValue("firstName", value);
                }
            },

            last_name: {
                type: DataTypes.VIRTUAL,
                get() {
                    return this.lastName;
                },
                set(value) {
                    this.setDataValue("lastName", value);
                }
            },

            email: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: {
                    name: "users_email_unique",
                    msg: "Email already registered"
                },
                validate: {
                    notNull: { msg: "Email is required" },
                    notEmpty: { msg: "Email cannot be empty" },
                    isEmail: { msg: "Must be a valid email address" }
                }
            },

            password: {
                type: DataTypes.STRING,
                allowNull: false,
                validate: {
                    notNull: { msg: "Password is required" },
                    notEmpty: { msg: "Password cannot be empty" }
                }
            }
        },
        {
            sequelize,
            modelName: "User",
            tableName: "Users",
            timestamps: true
        }
    );

    return User;
};