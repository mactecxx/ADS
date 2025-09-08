import { useState } from "react";

const mockProducts = [
  {
    title: "Wireless Bluetooth Headphones",
    price: "59.99",
    discount: "25",
    image: "https://m.media-amazon.com/images/I/61pBvlYk7aL._AC_SL1500_.jpg",
    link: "https://amazon.com/dp/example1"
  },
  {
    title: "Smartwatch Pro Edition",
    price: "129.99",
    discount: "40",
    image: "https://m.media-amazon.com/images/I/71hfjqk0sCL._AC_SL1500_.jpg",
    link: "https://amazon.com/dp/example2"
  },
  {
    title: "4K Action Camera",
    price: "89.99",
    discount: "30",
    image: "https://m.media-amazon.com/images/I/81tNwYefpLL._AC_SL1500_.jpg",
    link: "https://amazon.com/dp/example3"
  }
];

export default function App() {
  const [products] = useState(mockProducts);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold text-center mb-6">
        Hot Discount Deals 🔥
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {products.map((p, i) => (
          <div
            key={i}
            className="border rounded-2xl shadow-lg p-4 bg-white hover:shadow-xl transition"
          >
            <img src={p.image} alt={p.title} className="h-40 mx-auto" />
            <h2 className="text-lg font-semibold mt-3">{p.title}</h2>
            <p className="text-red-500 font-bold">
              ${p.price} ({p.discount}% OFF)
            </p>
            <a
              href={p.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 block bg-yellow-400 hover:bg-yellow-500 text-center py-2 rounded-lg font-bold"
            >
              Buy Now
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}