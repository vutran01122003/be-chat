require('dotenv').config();
const mongoose = require('mongoose');
const { DB_PASSWORD, DB_USER, DB_NAME } = process.env;
mongoose
    .connect(
        `mongodb+srv://${DB_USER}:${DB_PASSWORD}@cluster0.ph1yjqo.mongodb.net/${DB_NAME}`
    )
    .then(() => {
        console.log('MONGODB:::connected');
    })
    .catch((e) => {
        console.log(e);
    });

const accountSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            unique: true,
            required: true
        },
        password: {
            type: mongoose.Schema.Types.String,
            required: true
        }
    },
    {
        timestamps: true
    }
);

const Account = mongoose.model('accounts', accountSchema);

module.exports = Account;
