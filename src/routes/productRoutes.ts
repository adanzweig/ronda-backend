import express from "express";
import isAuth from "../middleware/isAuth";
import multer from "multer";
import path from "path";

// Configure storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // make sure this folder exists
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });
import * as ProductController from "../controllers/ProductController";

const productRoutes = express.Router();

// List all products
productRoutes.get("/products", isAuth, ProductController.index);

// Get a specific product by ID
productRoutes.get("/products/:id", isAuth, ProductController.show);

// Create a new product
productRoutes.post("/products", isAuth, upload.single("image"), ProductController.store);

// Update an existing product
productRoutes.put("/products/:id", isAuth,upload.single("image"), ProductController.update);

// Delete a product
productRoutes.delete("/products/:id", isAuth, ProductController.remove);

// Optional: List products by company
productRoutes.get(
  "/companies/:companyId/products",
  isAuth,
  ProductController.listByCompany
);

export default productRoutes;
