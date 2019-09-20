const { BN, constants, expectEvent, expectRevert, ether, balance } = require('openzeppelin-test-helpers');
const { ZERO_ADDRESS } = constants;

const gasSpent = require('../gas-spent-helper');

const {expect} = require('chai');

const TwistedAccessControls = artifacts.require('TwistedAccessControls');
const TwistedSisterToken = artifacts.require('TwistedSisterToken');
const TwistedArtistCommissionRegistry = artifacts.require('TwistedArtistCommissionRegistry');
const TwistedAuctionFundSplitter = artifacts.require('TwistedAuctionFundSplitter');
const TwistedAuction = artifacts.require('TwistedAuctionMock');

contract.only('Twisted Auction Tests', function ([
                                      creator,
                                      printingFund,
                                      bidder,
                                      anotherBidder,
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

    const halfEth = ether('0.5');
    const oneEth = ether('1');
    const oneHalfEth = ether('1.5');

    function now(){ return Math.floor( Date.now() / 1000 ) }
    function sleep(ms) {return new Promise(resolve => setTimeout(resolve, ms));}

    beforeEach(async function () {
        this.accessControls = await TwistedAccessControls.new({ from: creator });
        expect(await this.accessControls.isWhitelisted(creator)).to.be.true;

        this.token = await TwistedSisterToken.new(baseURI, this.accessControls.address, { from: creator });

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
            this.auctionFundSplitter.address,
            printingFund,
            now() + 2
        );

        expect(await this.auction.currentRound()).to.be.bignumber.equal('1');
        await this.auction.updateAuctionStartTime(now() - 50, { from: creator });

        await this.accessControls.addWhitelisted(this.auction.address);
        expect(await this.accessControls.isWhitelisted(this.auction.address)).to.be.true;
    });

    describe('happy path', function () {
        describe('bidding', function () {
            it('should be successful with valid params', async function () {
                const auctionContractBalance = await balance.tracker(this.auction.address);
                const bidderBalance = await balance.tracker(bidder);

                const param = new BN('2');
                ({ logs: this.logs, receipt: this.receipt} = await this.auction.bid(param, { value: oneEth, from: bidder }));
                expectEvent.inLogs(this.logs, 'BidAccepted', {
                    _round: new BN('1'),
                    _param: param,
                    _amount: oneEth,
                    _bidder: bidder
                });

                expect(await this.auction.winningRoundParameter(1)).to.be.bignumber.equal('2');
                expect(await this.auction.highestBidFromRound(1)).to.be.bignumber.equal(oneEth);
                expect(await this.auction.highestBidderFromRound(1)).to.be.equal(bidder);
                expect(await auctionContractBalance.delta()).to.be.bignumber.equal(oneEth);
                expect(await bidderBalance.delta()).to.be.bignumber.equal(oneEth.add(gasSpent(this.receipt)).mul(new BN('-1')));
            });

            it('should refund last bid if has been outbid', async function () {
                const param = new BN('2');
                await this.auction.bid(param, { value: oneEth, from: bidder });

                const auctionContractBalance = await balance.tracker(this.auction.address);
                const bidderBalance = await balance.tracker(bidder);
                const anotherBidderBalance = await balance.tracker(anotherBidder);

                const paramAnotherBidder = new BN('1');
                ({ logs: this.logs, receipt: this.receipt} = await this.auction.bid(paramAnotherBidder, { value: oneHalfEth, from: anotherBidder }));
                expectEvent.inLogs(this.logs, 'BidAccepted', {
                    _round: new BN('1'),
                    _param: paramAnotherBidder,
                    _amount: oneHalfEth,
                    _bidder: anotherBidder
                });

                expect(await this.auction.winningRoundParameter(1)).to.be.bignumber.equal('1');
                expect(await this.auction.highestBidFromRound(1)).to.be.bignumber.equal(oneHalfEth);
                expect(await this.auction.highestBidderFromRound(1)).to.be.equal(anotherBidder);
                expect(await auctionContractBalance.delta()).to.be.bignumber.equal(halfEth);
                expect(await bidderBalance.delta()).to.be.bignumber.equal(oneEth);
                expect(await anotherBidderBalance.delta()).to.be.bignumber.equal(oneHalfEth.add(gasSpent(this.receipt)).mul(new BN('-1')));
            });
        });

        describe('issuing the TWIST and round management', function () {
            beforeEach(async function () {
                await this.auction.bid(new BN('3'), { value: oneEth, from: bidder });
                expect(await this.auction.winningRoundParameter(1)).to.be.bignumber.equal('3');
                expect(await this.auction.highestBidderFromRound(1)).to.be.equal(bidder);

                await this.auction.updateRoundLength(0, { from: creator });
                expect(await this.auction.roundLengthInSeconds()).to.be.bignumber.equal('0');
            });

            it('should issue the TWIST at the end of a round', async function () {
                ({ logs: this.logs } = await this.auction.issueTwistAndPrepNextRound(randIPFSHash, { from: creator }));

                const expectedTokenId = new BN('1');
                expectEvent.inLogs(this.logs, 'RoundFinalised', {
                    _round: new BN('1'),
                    _nextRound: new BN('2'),
                    _issuedTokenId: expectedTokenId
                });

                expect(await this.auction.currentRound()).to.be.bignumber.equal('2');
                expect(await this.token.tokenOfOwnerByIndex(bidder, 0)).to.be.bignumber.equal(expectedTokenId);
                expect(await balance.current(this.auction.address)).to.be.bignumber.equal('0');
            });

            it('should correctly split funds after a TWIST is issued', async function () {
                const auctionContractBalance = await balance.tracker(this.auction.address);
                const printingFundBalance = await balance.tracker(printingFund);
                const artist1Balance = await balance.tracker(commission.artists[0]);
                const artist2Balance  = await balance.tracker(commission.artists[1]);
                const artist3Balance  = await balance.tracker(commission.artists[2]);

                ({ logs: this.logs } = await this.auction.issueTwistAndPrepNextRound(randIPFSHash, { from: creator }));

                expect(await auctionContractBalance.delta()).to.be.bignumber.equal(oneEth.mul(new BN('-1')));
                expect(await balance.current(this.auction.address)).to.be.bignumber.equal('0');
                expect(await printingFundBalance.delta()).to.be.bignumber.equal(halfEth);

                const modulo = new BN('10000');
                const artist1Delta = await artist1Balance.delta();
                expect(artist1Delta).to.be.bignumber.equal(
                    halfEth.div(modulo).mul(commission.percentages[0])
                );

                const artist2Delta = await artist2Balance.delta();
                expect(artist2Delta).to.be.bignumber.equal(
                    halfEth.div(modulo).mul(commission.percentages[1])
                );

                const artist3Delta = await artist3Balance.delta();
                expect(artist3Delta).to.be.bignumber.equal(
                    halfEth.div(modulo).mul(commission.percentages[2])
                );

                let artistTotalFundsReceived = artist1Delta.add(artist2Delta);
                artistTotalFundsReceived = artistTotalFundsReceived.add(artist3Delta);
                expect(artistTotalFundsReceived).to.be.bignumber.equal(halfEth);
            });

            it('should continue to issue successfully after a few rounds', async function () {
                // assumption is that a bid is received every round

                await this.auction.issueTwistAndPrepNextRound(randIPFSHash, { from: creator });
                expect(await this.auction.currentRound()).to.be.bignumber.equal('2');

                const newAuctionStartTime = (await this.auction.auctionStartTime()).sub(new BN('86400'));
                await this.auction.updateAuctionStartTime(newAuctionStartTime, { from: creator });
                expect(await this.auction.auctionStartTime()).to.be.bignumber.equal(newAuctionStartTime);

                await this.auction.updateRoundLength(500, { from: creator });
                expect(await this.auction.roundLengthInSeconds()).to.be.bignumber.equal('500');

                await this.auction.bid(new BN('1'), { value: oneHalfEth, from: anotherBidder });

                await this.auction.updateRoundLength(0, { from: creator });
                expect(await this.auction.roundLengthInSeconds()).to.be.bignumber.equal('0');

                await this.auction.issueTwistAndPrepNextRound(randIPFSHash, { from: creator });
                expect(await this.auction.currentRound()).to.be.bignumber.equal('3');

                expect(await balance.current(this.auction.address)).to.be.bignumber.equal('0');
            });

            it('should successfully update the number of rounds if required', async function () {
                await this.auction.updateNumberOfRounds(25, { from: creator });
                expect(await this.auction.numOfRounds()).to.be.bignumber.equal('25');
            });
        });
    });

    describe('should fail', function () {
        describe('on contract creation', function () {
            it('when start time is in the past', async function() {
                expectRevert(
                    TwistedAuction.new(
                        this.accessControls.address,
                        this.token.address,
                        this.auctionFundSplitter.address,
                        printingFund,
                        now() - 1
                    ),
                    "Auction start time is not in the future"
                );
            });
        });
        describe('when bidding', function () {
            it('if the last round has passed', async function () {
                await this.auction.updateCurrentRound(22, { from: creator });
                expect(await this.auction.currentRound()).to.be.bignumber.equal('22');
                expectRevert(
                    this.auction.bid(4, { value: oneEth, from: bidder }),
                    "Auction has ended"
                );
            });
            it('if bid is less than min bid', async function () {
                expectRevert(
                    this.auction.bid(7, { value: ether('0.005'), from: bidder }),
                    "The bid didn't reach the minimum bid threshold"
                );
            });
            it('if bid was not higher than last', async function () {
                await this.auction.bid(1, { value: oneEth, from: bidder });
                expectRevert(
                    this.auction.bid(4, { value: halfEth, from: anotherBidder }),
                    "The bid was not higher than the last"
                );
            });
            it('if the bidding window is not open for round', async function () {
                const newAuctionStartTime = new BN((now() + 50).toString());
                await this.auction.updateAuctionStartTime(newAuctionStartTime, { from: creator });
                expect(await this.auction.auctionStartTime()).to.be.bignumber.equal(newAuctionStartTime);
                expectRevert(
                    this.auction.bid(4, { value: oneEth, from: bidder }),
                    "This round's bidding window is not open"
                );
            });
        });
        describe('when issuing the TWIST and prepping the next round', function () {
            it('if the current round is still active', async function () {
                expectRevert(
                  this.auction.issueTwistAndPrepNextRound(randIPFSHash, { from: creator }),
                    "Current round still active"
                );
            });
            it('if no one has bid', async function () {
                await this.auction.updateRoundLength(0, { from: creator });
                expect(await this.auction.roundLengthInSeconds()).to.be.bignumber.equal('0');
                expectRevert(
                    this.auction.issueTwistAndPrepNextRound(randIPFSHash, { from: creator }),
                    "No one has bid"
                );
            });
        });
    });
});
