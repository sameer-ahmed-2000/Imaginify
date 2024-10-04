const fs = require("fs");
const { PrismaClient } = require('./@prisma/client');
const prisma = new PrismaClient();
async function query(data) {
    try {
        const fetch = (await import('node-fetch')).default;
        const tokenRecord = await prisma.token.findUnique({
            where: { userId:"66d49e4d2dc76c93d2be3b6f" },
        });
        console.log(tokenRecord.accessToken)
        const response = await fetch(
            "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-dev",
            {
                headers: {
                    Authorization: `Bearer ${tokenRecord.accessToken}`, // Replace with your actual API token
                    "Content-Type": "application/json",
                },
                method: "POST",
                body: JSON.stringify(data),
            }
        );

        if (response.ok) {
            const buffer = await response.buffer(); // Convert Blob to Buffer
            const filename = "image.jpg"; // Set your desired filename, adjust extension if needed
            fs.writeFileSync(filename, buffer);
            console.log(`Image saved as ${filename}`);
        } else {
            const errorText = await response.text(); // Log the response body for more details
            console.error(`Error fetching image: ${response.status} ${response.statusText}`);
            console.error(`Error details: ${errorText}`);
        }
    } catch (error) {
        console.error("An error occurred:", error.message);
    }
}

// Example usage:
query({ "inputs": "nudes" });
