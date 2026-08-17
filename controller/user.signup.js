const signupService = require("../service/user.signup.service");

const signupController = async (req, res) => {
    try {
        const {
            name,
            phonenumber,
            password,
            email,
            district,
            state,
            address,
            cache_folder
        } = req.body;

        const result = await signupService(
            name,
            phonenumber,
            password,
            email,
            district,
            state,
            address,
            cache_folder
        );

        if (result.status === 201) {
            res.cookie("token", result.token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                maxAge: 3600000
            });

            return res.status(201).json({
                success: true,
                message: "Signup successful",
                token: result.token
            });
        }

        return res.status(result.status || 400).json({
            success: false,
            message: result.message || "Signup failed"
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

module.exports = signupController;