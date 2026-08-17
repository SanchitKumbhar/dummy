const userlogincontroller=require("../controller/user.login");
const signupController=require("../controller/user.signup");
const middleware=require("../middleware/auth.middleware");
const {
	getProfileController,
	updateProfileController
} = require("../controller/user.settings.controller");

const express=require("express")

const router=express.Router();

router.post("/v1/login",userlogincontroller);
router.post("/v1/signup",signupController);
router.get("/v1/profile", middleware, getProfileController);
router.patch("/v1/profile", middleware, updateProfileController);

module.exports=router;