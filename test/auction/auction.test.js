const { BN, constants, expectEvent, expectRevert } = require('openzeppelin-test-helpers');
const { ZERO_ADDRESS } = constants;

const {expect} = require('chai');

const TwistedAccessControls = artifacts.require('TwistedAccessControls');
const TwistedToken = artifacts.require('TwistedToken');
const TwistedArtistCommissionRegistry = artifacts.require('TwistedArtistCommissionRegistry');
const TwistedAuctionFundSplitter = artifacts.require('TwistedAuctionFundSplitter');
const TwistedAuction = artifacts.require('TwistedAuction');

contract.only('Twisted Auction Tests', function ([
                                      creator,
                                      printingFund,
                                      ...accounts
                                  ]) {
    const baseURI = "ipfs/";
    const randIPFSHash = "QmRLHatjFTvm3i4ZtZU8KTGsBTsj3bLHLcL8FbdkNobUzm";

    // Commission splits and artists
    const commission = {
        percentages: [
            new BN(3300),
            new BN(3300),
            new BN(3400)
        ],
        artists: [
            accounts[0],
            accounts[1],
            accounts[2]
        ]
    };

    function now(){ return Math.floor( Date.now() / 1000 ) }

    beforeEach(async function () {
        this.accessControls = await TwistedAccessControls.new({ from: creator });
        (await this.accessControls.isWhitelisted(creator)).should.be.true;

        this.token = await TwistedToken.new(baseURI, this.accessControls.address, { from: creator });

        this.artistCommissionRegistry = await TwistedArtistCommissionRegistry.new(this.accessControls.address, { from: creator });
        await this.artistCommissionRegistry.setCommissionSplits(commission.percentages, commission.artists, { from: creator });
        const {
            _percentages,
            _artists
        } = await this.artistCommissionRegistry.getCommissionSplits();
        expect(JSON.stringify(_percentages)).to.be.deep.equal(JSON.stringify(commission.percentages));
        expect(_artists).to.be.deep.equal(commission.artists);

        this.auctionFundSplitter = await TwistedAuctionFundSplitter.new(this.artistCommissionRegistry.address, { from: creator });

        this.auction = await TwistedAuction.new(
            this.accessControls.address,
            this.token.address,
            this.auctionFundSplitter.address
        );
    });

    describe('happy path', function () {
        describe('creating the auction', function () {
            it('should be successful with valid parameters', async function () {
                ({ logs: this.logs } = await this.auction.createAuction(printingFund, now() + 2, { from: creator }));
                expectEvent.inLogs(this.logs, 'AuctionCreated', {
                    _creator: creator
                });

                expect(await this.auction.currentRound()).to.be.bignumber.equal('1');
            });
        });
    });
});