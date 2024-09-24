import styles from "./swap.module.css";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import React, { useState } from "react";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { useConnection, useNetwork } from "../../wallet/WalletContextProvider";

interface Asset {
  name: string;
  mint: string;
  decimals: number;
}

const assets: Asset[] = [
  {
    name: "SOL",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
  },
  {
    name: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
  },
];

const Swap: React.FC = () => {
  const [fromAsset, setFromAsset] = useState<Asset>(assets[0]);
  const [toAsset, setToAsset] = useState<Asset>(assets[1]);
  const [fromAmount, setFromAmount] = useState<number>(0);
  const [toAmount, setToAmount] = useState<number>(0);
  const [quoteResponse, setQuoteResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const wallet = useWallet();
  const connection = useConnection();
  const { network } = useNetwork();

  const handleFromAssetChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedAsset =
      assets.find((asset) => asset.name === event.target.value) || assets[0];
    setFromAsset(selectedAsset);
    getQuote(fromAmount, selectedAsset, toAsset);
  };

  const handleToAssetChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedAsset =
      assets.find((asset) => asset.name === event.target.value) || assets[0];
    setToAsset(selectedAsset);
    getQuote(fromAmount, fromAsset, selectedAsset);
  };

  const handleFromValueChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const amount = Number(event.target.value);
    if (!isNaN(amount) && amount > 0) {
      setFromAmount(amount);
      getQuote(amount, fromAsset, toAsset);
    } else {
      setFromAmount(0);
      setToAmount(0);
      toast.error("Please enter a valid amount.");
    }
  };

  async function getQuote(currentAmount: number, from: Asset, to: Asset) {
    if (currentAmount <= 0) {
      console.error("Invalid fromAmount value:", currentAmount);
      setToAmount(0);
      return;
    }

    try {
      const amountInSmallestUnit = Math.floor(
        currentAmount * Math.pow(10, from.decimals)
      );

      const response = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${from.mint}&outputMint=${to.mint}&amount=${amountInSmallestUnit}&slippage=0.5&network=${
          network === WalletAdapterNetwork.Devnet ? "devnet" : "mainnet-beta"
        }`
      );
      const quote = await response.json();

      if (quote && quote.outAmount) {
        const outAmountNumber =
          Number(quote.outAmount) / Math.pow(10, to.decimals);
        setToAmount(outAmountNumber);
        setQuoteResponse(quote);
      } else {
        throw new Error("Invalid quote response");
      }
    } catch (error: any) {
      console.error("Error fetching quote:", error);
      toast.error("Error fetching quote: " + error.message);
      setToAmount(0);
    }
  }

  async function signAndSendTransaction() {
    if (!wallet.connected || !wallet.signTransaction || !wallet.publicKey) {
      toast.error(
        "Wallet is not connected or does not support signing transactions"
      );
      return;
    }

    if (!quoteResponse) {
      toast.error("No quote available for this swap.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        "https://quote-api.jup.ag/v6/swap-instructions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            quoteResponse,
            userPublicKey: wallet.publicKey.toBase58(),
          }),
        }
      );

      const instructionsResponse = await response.json();
      console.log("Swap Instructions API response:", instructionsResponse);

      if (instructionsResponse.error) {
        throw new Error(
          "Failed to get swap instructions: " + instructionsResponse.error
        );
      }

      const { swapInstruction, signers } = instructionsResponse;

      if (!swapInstruction || typeof swapInstruction !== "object") {
        throw new Error("Invalid swap instructions format.");
      }

      const { programId, accounts, data } = swapInstruction;

      if (!programId || !accounts || !Array.isArray(accounts) || !data) {
        throw new Error("Malformed swap instruction data.");
      }

      const transaction = new Transaction();
      transaction.feePayer = wallet.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      const transactionInstruction = new TransactionInstruction({
        programId: new PublicKey(programId),
        keys: accounts.map((key: {pubkey: string, isSigner: boolean, isWritable: boolean}) => ({
          pubkey: new PublicKey(key.pubkey),
          isSigner: key.isSigner,
          isWritable: key.isWritable,
        })),
        data: Buffer.from(data, "base64"),
      });

      transaction.add(transactionInstruction);

      if (signers && Array.isArray(signers)) {
        signers.forEach((signer: Signer) => {
          transaction.partialSign(signer);
        });
      }

      const signedTransaction = await wallet.signTransaction(transaction);
      const rawTransaction = signedTransaction.serialize();

      const txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false, 
        preflightCommitment: "processed",
        maxRetries: 5,
      });


      await connection.confirmTransaction(
        {
          blockhash,
          lastValidBlockHeight,
          signature: txid,
        },
        "confirmed"
      );

      console.log(
        `Transaction details: https://solscan.io/tx/${txid}?cluster=${
          network === WalletAdapterNetwork.Devnet ? "devnet" : "mainnet-beta"
        }`
      );
      toast.success("Transaction confirmed!");
    } catch (error: any) {
      console.error("Error signing or sending the transaction:", error);
      if (error.logs) {
        console.error("Transaction Logs:", error.logs);
        toast.error(`Transaction failed: ${error.logs.join("\n")}`);
      } else {
        toast.error(error.message || "Error signing or sending the transaction");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.body}>
      <div className={styles.innerContainer}>
        <div className={styles.inputContainer}>
          <div className={styles.labels}>You're paying</div>
          <input
            value={fromAmount}
            onChange={handleFromValueChange}
            className={styles.inputField}
            type="number"
            min="0"
            placeholder="Amount"
          />
          <select
            value={fromAsset.name}
            onChange={handleFromAssetChange}
            className={styles.selectField}
          >
            {assets.map((asset) => (
              <option key={asset.mint} value={asset.name}>
                {asset.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.inputContainer}>
          <div className={styles.labels}>To receive</div>
          <input
            type="number"
            value={toAmount}
            className={styles.inputField}
            readOnly
            placeholder="Amount"
          />
          <select
            value={toAsset.name}
            onChange={handleToAssetChange}
            className={styles.selectField}
          >
            {assets.map((asset) => (
              <option key={asset.mint} value={asset.name}>
                {asset.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={signAndSendTransaction}
          className={styles.button}
          disabled={!wallet.connected || loading || !quoteResponse}
        >
          {loading ? "Loading..." : "Swap"}
        </button>
        <ToastContainer />
      </div>
    </div>
  );
};

export default Swap;
