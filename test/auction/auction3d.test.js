const { BN, constants, expectEvent, expectRevert, ether, balance } = require('openzeppelin-test-helpers');

const {expect} = require('chai');

const TwistedSisterAccessControls = artifacts.require('TwistedSisterAccessControls');
const TwistedSisterToken = artifacts.require('TwistedSisterToken');
const TwistedSister3DToken = artifacts.require('TwistedSister3DToken');
const TwistedSisterArtistCommissionRegistry = artifacts.require('TwistedSisterArtistCommissionRegistry');
const TwistedSisterArtistFundSplitter = artifacts.require('TwistedSisterArtistFundSplitter');
const TwistedSister3DAuction = artifacts.require('TwistedSister3DAuction');

contract.only('Twisted 3D Auction Tests', function ([
                                                creator,
                                                buyer,
                                                twistHolder1,
                                                ...accounts
                                            ]) {
    const fromCreator = { from: creator };

    // Commission splits and artists
    const commission = {
        percentages: [
            new BN(5000),
            new BN(5000),
        ],
        artists: [
            accounts[0],
            accounts[1],
        ]
    };

    const baseURI = "ipfs/";
    const randIPFSHash = "QmRLHatjFTvm3i4ZtZU8KTGsBTsj3bLHLcL8FbdkNobUzm";

    const minBid = ether('0.02');
    const halfEth = ether('0.5');
    const oneEth = ether('1');
    const justOverOneEth = ether('1.01');
    const oneHalfEth = ether('1.5');

    async function sendValue(from, to, value) {
        await web3.eth.sendTransaction({from, to, value});
    }

    beforeEach(async function () {
        this.accessControls = await TwistedSisterAccessControls.new(fromCreator);
        expect(await this.accessControls.isWhitelisted(creator)).to.be.true;

        this.artistCommissionRegistry = await TwistedSisterArtistCommissionRegistry.new(this.accessControls.address, fromCreator);
        await this.artistCommissionRegistry.setCommissionSplits(commission.percentages, commission.artists, fromCreator);
        const {
            _percentages,
            _artists
        } = await this.artistCommissionRegistry.getCommissionSplits();
        expect(JSON.stringify(_percentages)).to.be.deep.equal(JSON.stringify(commission.percentages));
        expect(_artists).to.be.deep.equal(commission.artists);

        this.artistFundSplitter = await TwistedSisterArtistFundSplitter.new(this.artistCommissionRegistry.address, fromCreator);

        this.twistToken = await TwistedSisterToken.new(baseURI, this.accessControls.address, 0, this.artistFundSplitter.address, fromCreator);
        this.twist3DToken = await TwistedSister3DToken.new(baseURI, this.accessControls.address, this.artistFundSplitter.address, this.twistToken.address, fromCreator);

        this.auction = await TwistedSister3DAuction.new(
            this.accessControls.address,
            this.twist3DToken.address,
            this.artistFundSplitter.address,
            this.twistToken.address
        );

        await this.accessControls.addWhitelisted(this.auction.address);
        expect(await this.accessControls.isWhitelisted(this.auction.address)).to.be.true;

        await this.twistToken.createTwisted(1, 0, randIPFSHash, twistHolder1);
    });

    describe('happy path', function() {
        it('can purchase the TWIST3D token and split funds', async function () {
            const balancesBefore = {
                twistHolder1: await balance.tracker(twistHolder1),
                artist1: await balance.tracker(commission.artists[0]),
                artist2: await balance.tracker(commission.artists[1]),
            };

            await sendValue(buyer, this.auction.address, oneEth);
            ({logs: this.logs} = await this.auction.issue3DTwistToken(randIPFSHash, fromCreator));
            expectEvent.inLogs(this.logs, 'TWIST3DIssued', {
                _buyer: buyer,
                _value: oneEth
            });

            expect(await this.twist3DToken.ownerOf(1)).to.be.equal(buyer);
            await verifyFundSplitting(balancesBefore, oneEth, this.twistToken);
        });
    });

    const verifyFundSplitting = async (balancesBefore, totalSplit, twistToken) => {
        const singleUnitOfValue = totalSplit.div(new BN('100'));

        const tokenHolderSplit = singleUnitOfValue.mul(new BN('90'));
        const individualHolderSplit = tokenHolderSplit.div(await twistToken.totalSupply());
        expect(await balancesBefore.twistHolder1.delta()).to.be.bignumber.equal(individualHolderSplit);

        const artistSplit = singleUnitOfValue.mul(new BN('10'));
        const individualArtistSplit = artistSplit.div(new BN(commission.artists.length.toString()));
        expect(await balancesBefore.artist1.delta()).to.be.bignumber.equal(individualArtistSplit);
        expect(await balancesBefore.artist2.delta()).to.be.bignumber.equal(individualArtistSplit);
    };
});