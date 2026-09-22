const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class Todo extends Model {
        static associate(models) {
            Todo.belongsTo(models.User, {
                foreignKey: "userId",
                as: "user",
                onDelete: "CASCADE"
            });
        }
    }

    Todo.init(
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },

            title: {
                type: DataTypes.STRING,
                allowNull: false,
                validate: {
                    notNull: { msg: "Title is required" },
                    notEmpty: { msg: "Title cannot be empty" }
                }
            },

            description: {
                type: DataTypes.TEXT,
                allowNull: true
            },

            dueDate: {
                type: DataTypes.DATEONLY,
                allowNull: false,
                validate: {
                    notNull: { msg: "Due date is required" },
                    notEmpty: { msg: "Due date cannot be empty" }
                }
            },

            due_date: {
                type: DataTypes.VIRTUAL,
                get() {
                    return this.dueDate;
                },
                set(value) {
                    this.setDataValue("dueDate", value);
                }
            },

            completed: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },

            userId: {
                type: DataTypes.INTEGER,
                allowNull: false
            }
        },
        {
            sequelize,
            modelName: "Todo",
            tableName: "Todos",
            timestamps: true
        }
    );

    return Todo;
};