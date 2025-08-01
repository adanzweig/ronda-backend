import express from "express";
import isAuth from "../middleware/isAuth";

import * as ProductController from "../controllers/ProductController";

const productRoutes = express.Router();

// List all products
productRoutes.get("/products", isAuth, ProductController.index);

// Get a specific product by ID
productRoutes.get("/products/:id", isAuth, ProductController.show);

// Create a new product
productRoutes.post("/products", isAuth, ProductController.store);

// Update an existing product
productRoutes.put("/products/:id", isAuth, ProductController.update);

// Delete a product
productRoutes.delete("/products/:id", isAuth, ProductController.remove);

// Optional: List products by company
productRoutes.get(
  "/companies/:companyId/products",
  isAuth,
  ProductController.listByCompany
);

export default productRoutes;
