import multer from "multer";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const storage = multer.memoryStorage();

const fileFilter: multer.Options["fileFilter"] = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    return cb(null, true);
  }

  cb(new Error("Only image files are allowed"));
};

export const imageUpload = multer({
  storage,
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
  },
  fileFilter,
});

