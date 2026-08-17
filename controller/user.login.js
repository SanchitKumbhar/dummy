const userloginService = require("../service/user.login.service");
const userlogin = async (req, res) => {
    try {
        const { name, phonenumber, password } = req.body;

        const result = await userloginService(phonenumber, password);

        if (result.status == 201) {
            res.cookie('token', result.token, {
                httpOnly: true,                  // Prevents client-side JS from reading the cookie (XSS protection)
                secure: process.env.NODE_ENV === 'production', // Forces HTTPS in production
                sameSite: 'strict',              // Protects against Cross-Site Request Forgery (CSRF)
                maxAge: 3600000                  // Cookie expiration time in milliseconds (1 hour)
            });

            return res.status(201).json({
                success: true,
                token: result.token
            });
        }

        return res.status(result.status).json({
            success: false,
            message: result.message || "Request failed"
        });
    }
    catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }

}

module.exports = userlogin;