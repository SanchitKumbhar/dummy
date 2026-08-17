const {
    getProfileService,
    updateProfileService
} = require("../service/user.settings.service");

const getProfileController = async (req, res) => {
    try {
        const storeId = req.storeId;
        const result = await getProfileService(storeId);

        if (result.status === 404) {
            return res.status(404).json({ success: false, message: result.message });
        }

        return res.status(200).json({ success: true, data: result.profile });
    } catch (error) {
        console.error("getProfileController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const updateProfileController = async (req, res) => {
    try {
        const storeId = req.storeId;
        const { store_name } = req.body;

        if (!store_name || !String(store_name).trim()) {
            return res.status(400).json({ success: false, message: "store_name is required" });
        }

        const result = await updateProfileService(storeId, req.body);

        if (result.status === 404) {
            return res.status(404).json({ success: false, message: result.message });
        }
        if (result.status === 409) {
            return res.status(409).json({ success: false, message: result.message });
        }

        const latest = await getProfileService(storeId);
        return res.status(200).json({ success: true, message: "Profile updated", data: latest.profile });
    } catch (error) {
        console.error("updateProfileController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

module.exports = {
    getProfileController,
    updateProfileController
};
